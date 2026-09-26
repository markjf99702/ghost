// Plays Ghost in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

// The service worker's file list has to cover everything the page loads, or it won't work offline.
const sw = await readFile(join(root, 'sw.js'), 'utf8');
const listed = new Set([...sw.matchAll(/'([^']+\.(?:js|css|woff2|svg|png|html|webmanifest))'/g)].map(m => m[1]));
for (const f of ['index.html', 'css/app.css', ...(await readFile(join(root, 'index.html'), 'utf8')).matchAll(/(?:href|src)="([^"#:]+)"/g)].map(m => (typeof m === 'string' ? m : m[1]))) {
  assert.ok(listed.has(f), `sw.js doesn't list ${f}`);
}
for (const m of (await Promise.all(['app', 'board', 'art', 'rules', 'ghosts', 'dict', 'packed'].map(f => readFile(join(root, `js/${f}.js`), 'utf8')))).join('\n').matchAll(/from '\.\/([^']+)'|import\('\.\/([^']+)'\)/g)) {
  const f = `js/${m[1] || m[2]}`;
  assert.ok(listed.has(f), `sw.js doesn't list ${f}`);
}

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, reducedMotion: 'reduce' });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });

await page.goto(base);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.evaluate(() => document.fonts.ready);

const state = () => page.evaluate(() => ghostGame.state());
const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 15000 });
async function tap(letter) {
  const box = await page.locator(`.letter[data-letter="${letter}"]`).boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}
// Put the game into a particular spot, built with the real rules.
async function setUp(fn) {
  await page.evaluate(`ghostGame.set((${fn})(ghostGame.rules, ghostGame.dict))`);
}
const youAndWisp = `R.newGame([{ kind: 'person', name: 'You' }, { kind: 'ghost', ghost: 'wisp', name: 'Wisp' }])`;

// The table: you and Wisp by default.
assert.equal(await page.locator('#setup').isVisible(), true);
assert.equal(await page.locator('.ghost-pick.g-wisp').getAttribute('aria-pressed'), 'true');
await page.click('.ghost-pick.g-wisp');
assert.equal(await page.locator('#start').isDisabled(), true, 'you need someone to play against');
await page.click('.ghost-pick.g-wisp');
await page.click('#start');
assert.equal(await page.locator('#game').isVisible(), true);
assert.equal((await page.locator('.player').count()), 2);

// Slide the planchette from A to B and let go: B is played.
{
  const a = await page.locator('.letter[data-letter="a"]').boundingBox();
  const b = await page.locator('.letter[data-letter="b"]').boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  assert.equal(await page.locator('.word .pending').textContent(), 'B', 'the letter under the planchette shows before you let go');
  await page.mouse.up();
  const s = await state();
  assert.equal(s.frag, 'b');
}
// Wisp answers with a letter of its own.
await until(() => ghostGame.state().frag.length === 2 || ghostGame.state().phase !== 'play');
assert.equal((await state()).turn, 0);

// Challenged: spell the rest of a word on the board and say yes.
await setUp(`(R, d) => {
  let s = ${youAndWisp};
  s = ['g', 'h', 'o'].reduce((st, c) => R.addLetter(st, c, d.endsRound), s); // you g, Wisp h, you o
  s = R.challenge(s);                                                       // Wisp challenges you
  return s;
}`);
assert.match(await page.locator('#status').textContent(), /Wisp challenges you/);
await tap('s');
await tap('t');
assert.equal((await state()).challenge.extra, 'st');
await page.click('#done');
await until(() => !document.getElementById('result').hidden);
assert.match(await page.locator('#resultKicker').textContent(), /challenge fails/i);
assert.equal(await page.locator('#resultWord').textContent(), 'GHOST');
assert.match(await page.locator('.result-loser').textContent(), /Wisp takes a G/);

// Next round: Wisp lost, so Wisp starts.
await page.click('#nextRound');
assert.equal((await state()).round, 2);
await until(() => ghostGame.state().frag.length === 1);

// A word the list doesn't know: fix it, or count it anyway.
await setUp(`(R, d) => R.challenge(['g', 'h', 'o'].reduce((st, c) => R.addLetter(st, c, d.endsRound), ${youAndWisp}))`);
await tap('x');
await tap('x');
await page.click('#done');
await until(() => document.getElementById('countIt'));
assert.match(await page.locator('#status').textContent(), /GHOXX isn’t in the word list/);
await page.click('#erase');
assert.equal((await state()).challenge.extra, 'x');
await tap('x');
await page.click('#countIt');
await until(() => !document.getElementById('result').hidden);
assert.match(await page.locator('#resultKicker').textContent(), /challenge fails/i);

// Challenge a ghost that bluffed: it owns up.
await setUp(`(R, d) => {
  let s = R.addLetter(${youAndWisp}, 'q', d.endsRound);
  return R.addLetter(s, 'z', d.endsRound, { bluff: true });
}`);
assert.match(await page.locator('#challenge').textContent(), /Challenge Wisp/);
await page.click('#challenge');
await until(() => !document.getElementById('result').hidden);
assert.match(await page.locator('#resultKicker').textContent(), /bluffing/i);
assert.match(await page.locator('.result-loser').textContent(), /Wisp takes a G/);

// A ghost challenges a letter that goes nowhere.
await setUp(`(R) => ({ ...${youAndWisp}, frag: 'qu', last: 1, turn: 0 })`);
await tap('x');
await until(() => ghostGame.state().phase === 'naming');
assert.match(await page.locator('#status').textContent(), /challenges you/);
await page.click('#giveUp');
await until(() => !document.getElementById('result').hidden);
assert.match(await page.locator('.result-loser').textContent(), /You take a G/);

// Spell the last letter of GHOST yourself and the game is over.
await setUp(`(R) => {
  const s = ${youAndWisp};
  s.players[0].letters = 4;
  return { ...s, frag: 'ghos', last: 1, turn: 0 };
}`);
await tap('t'); // ghost
await until(() => !document.getElementById('result').hidden);
assert.match(await page.locator('.result-loser').textContent(), /That’s GHOST/);
assert.match(await page.locator('.verdict').textContent(), /Wisp wins the game/);
await page.click('#again');
assert.equal((await state()).round, 1);
assert.equal(await page.locator('#result').isHidden(), true);

// The keyboard works on a computer.
await setUp(`(R) => ${youAndWisp}`);
await page.keyboard.press('k');
assert.equal((await state()).frag, 'k');

// Menu and rules open and close.
await page.click('#menuBtn');
await page.click('#menuRules');
assert.equal(await page.locator('#rules').isVisible(), true);
await page.click('#rules .primary');

// The game in progress survives a reload.
const frag = (await state()).frag;
await page.reload();
await page.evaluate(() => document.fonts.ready);
assert.equal(await page.locator('#game').isVisible(), true);
assert.equal((await state()).frag.slice(0, frag.length), frag);

// Fits a phone: nothing scrolls sideways, even on a small one, on either screen.
for (const width of [390, 320]) {
  await page.setViewportSize({ width, height: 700 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `the game scrolls sideways at ${width}px`);
}
await page.click('#menuBtn');
await page.click('#menuTable');
await page.click('#addPerson');
await page.fill('#p1', 'Sam');
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the table scrolls sideways at 320px');
await page.setViewportSize({ width: 390, height: 844 });

// Pass and play: two people take turns.
await page.click('.ghost-pick.g-wisp');
await page.click('#start');
assert.deepEqual((await state()).players.map(p => p.name), ['Player 1', 'Sam'], '“You” is only used when you play alone');
await tap('c');
assert.match(await page.locator('#status').textContent(), /Sam’s turn/);

// Works offline once it has been opened.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
await ctx.setOffline(true);
await page.reload();
assert.ok(await page.title(), 'the page did not load offline');
assert.equal(await page.locator('#game').isVisible(), true);
await ctx.setOffline(false);

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while playing');
await browser.close();
server.close();
console.log('all good');
