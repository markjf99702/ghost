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
async function tapCorner(which) {
  const box = await page.locator(`.corner.${which}`).boundingBox();
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

// With motion on, the letters already on the table hold still while you choose, and when Wisp adds one.
await page.emulateMedia({ reducedMotion: 'no-preference' });
await setUp(`(R) => ({ ...${youAndWisp}, frag: 'pla', last: 1, turn: 0 })`);
await page.waitForTimeout(700); // PLA fades in, once
{
  const fading = () => page.evaluate(() => [...document.querySelectorAll('#word span')].slice(0, 3).filter(sp => sp.getAnimations().length).length);
  const n = await page.locator('.letter[data-letter="n"]').boundingBox();
  const c = await page.locator('.letter[data-letter="c"]').boundingBox();
  await page.mouse.move(n.x + n.width / 2, n.y + n.height / 2);
  await page.mouse.down();
  assert.equal(await fading(), 0, 'PLA faded in again when you pressed on N');
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2, { steps: 4 });
  assert.equal(await fading(), 0, 'PLA faded in again when you slid to C');
  await page.mouse.up();
  await until(() => ghostGame.state().frag.length === 5);
  assert.equal(await fading(), 0, 'PLA faded in again when Wisp added a letter');
}
// And when you erase a letter, or the word you named is taken and the letters you added leave the table.
await setUp(`(R, d) => R.setExtra(R.challenge(['g', 'h', 'o'].reduce((st, c) => R.addLetter(st, c, d.endsRound), ${youAndWisp})), 'stx')`);
await page.waitForTimeout(700); // GHOSTX fades in, once
{
  const fading = () => page.evaluate(() => [...document.querySelectorAll('#word span:not(.cursor)')].filter(sp => sp.getAnimations().length).map(sp => sp.textContent).join(''));
  await page.click('#erase');
  assert.equal(await fading(), '', 'GHOST faded in again when you erased the X');
  await page.click('#done');
  await until(() => ghostGame.state().phase !== 'naming');
  assert.equal(await fading(), '', 'GHO faded in again when GHOST was taken');
}
await page.emulateMedia({ reducedMotion: 'reduce' });

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

// YES on the board needs four letters, like the plaque: Ben can't count CA.
const annAndBen = `R.newGame([{ kind: 'person', name: 'Ann' }, { kind: 'person', name: 'Ben' }])`;
await setUp(`(R) => R.challenge({ ...${annAndBen}, frag: 'ca', last: 1, turn: 0 })`);
await tapCorner('yes');
await page.waitForTimeout(300);
assert.equal((await state()).challenge.tries, 0, 'YES tried CA as a word');
assert.equal(await page.locator('#countIt').count(), 0);

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

// The board's own NO and YES work for you (the first seat), not just the plaques.
await setUp(`(R, d) => R.addLetter(R.addLetter(${youAndWisp}, 'q', d.endsRound), 'z', d.endsRound, { bluff: true })`);
await tapCorner('no');
await until(() => !document.getElementById('result').hidden);
assert.match(await page.locator('#resultKicker').textContent(), /bluffing/i, 'NO didn’t challenge Wisp');
await setUp(`(R, d) => R.challenge(['g', 'h', 'o'].reduce((st, c) => R.addLetter(st, c, d.endsRound), ${youAndWisp}))`);
await tap('s');
await tap('t');
await tapCorner('yes');
await until(() => !document.getElementById('result').hidden);
assert.equal(await page.locator('#resultWord').textContent(), 'GHOST', 'YES didn’t name GHOST');

// The word on the result card stays on one line on a phone, however long.
await page.setViewportSize({ width: 360, height: 780 });
for (const word of ['phantoms', 'uncharacteristically']) {
  await setUp(`(R) => R.nameWord(R.setExtra(R.challenge({ ...${youAndWisp}, frag: '${word.slice(0, 3)}', last: 0, turn: 1 }), '${word.slice(3)}'), '${word}', true)`);
  await until(() => !document.getElementById('result').hidden);
  const lines = await page.evaluate(() => { const el = document.getElementById('resultWord'); return Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)); });
  assert.equal(lines, 1, `${word.toUpperCase()} broke onto ${lines} lines`);
}
await page.setViewportSize({ width: 390, height: 844 });

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
assert.equal(await page.locator('#board .lit').count(), 0, 'the last game’s T is still lit');
assert.equal(await page.locator('.planchette.resting').count(), 1, 'the planchette isn’t resting');

// A new game in the middle of a ghost's move: its glide doesn't land on the new board.
await page.emulateMedia({ reducedMotion: 'no-preference' });
await setUp(`(R) => ({ ...${youAndWisp}, frag: 'ca', last: 0, turn: 1 })`);
await until(() => document.querySelector('.planchette').getAnimations().some(a => a.effect.getKeyframes().length === 3)); // gliding to its letter
await page.click('#menuBtn');
await page.click('#menuNew');
await page.waitForTimeout(1500);
assert.equal(await page.locator('#board .lit').count(), 0, 'Wisp’s letter lit up on the new board');
assert.equal((await state()).frag, '');
await page.emulateMedia({ reducedMotion: 'reduce' });

// Enter on a focused button does that button's job, without also naming the word.
await setUp(`(R, d) => R.setExtra(R.challenge(['g', 'h', 'o'].reduce((st, c) => R.addLetter(st, c, d.endsRound), ${youAndWisp})), 'st')`);
await page.focus('#erase');
await page.keyboard.press('Enter');
{
  const s = await state();
  assert.deepEqual([s.phase, s.challenge.extra], ['naming', 's'], 'Enter on Erase named GHOST instead of erasing');
}
await page.waitForTimeout(900); // a letter ignores a click within 800 ms of a tap on the board
await page.focus('.letter[data-letter="t"]');
await page.keyboard.press('Enter');
{
  const s = await state();
  assert.deepEqual([s.challenge.extra, s.challenge.tries], ['st', 0], 'Enter on T tried GHOS as a word');
}
await page.evaluate(() => document.activeElement.blur());
await page.keyboard.press('Enter'); // with no button focused, Enter names it
await until(() => !document.getElementById('result').hidden);
assert.equal(await page.locator('#resultWord').textContent(), 'GHOST');

// After the menu, the focus is back on the Menu button. Enter still names the word, and the menu stays shut.
await setUp(`(R) => ${youAndWisp}`);
await page.click('#menuBtn');
await page.click('#menuNew');
await setUp(`(R, d) => R.setExtra(R.challenge(['g', 'h', 'o'].reduce((st, c) => R.addLetter(st, c, d.endsRound), ${youAndWisp})), 'st')`);
assert.equal(await page.evaluate(() => document.activeElement.id), 'menuBtn');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
assert.equal(await page.locator('#menu').evaluate(d => d.open), false, 'Enter on the Menu button opened the menu');
await until(() => !document.getElementById('result').hidden);
assert.equal(await page.locator('#resultWord').textContent(), 'GHOST');

// The keyboard's focus ring shows up on the board's pale wood: at least 3:1, as WCAG asks.
await setUp(`(R) => ${youAndWisp}`);
await page.focus('.letter[data-letter="l"]');
await page.keyboard.press('Tab');
{
  const ring = await page.evaluate(() => { const a = document.activeElement; return { letter: a.dataset.letter, shown: a.matches(':focus-visible'), color: getComputedStyle(a).outlineColor }; });
  assert.deepEqual([ring.letter, ring.shown], ['m', true]);
  const lum = rgb => rgb.match(/\d+/g).slice(0, 3).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [a, b] = [lum(ring.color), lum('rgb(234, 210, 164)')].sort((x, y) => y - x); // --board-1, the palest wood
  assert.ok((a + 0.05) / (b + 0.05) >= 3, `the focus ring is ${((a + 0.05) / (b + 0.05)).toFixed(2)}:1 on the board`);
}

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

// Every card shows all of GHOST: three at the table on a phone, and six on a laptop.
{
  const clipped = () => page.evaluate(() => [...document.querySelectorAll('.player .letters')].filter(L => L.scrollWidth > L.clientWidth).length);
  const seats = ['You:', 'Sam:', 'Ann:', 'Wisp:wisp', 'Maud:maud', 'Hollis:hollis'].map(t => t.split(':')).map(([name, ghost]) => (ghost ? `{ kind: 'ghost', ghost: '${ghost}', name: '${name}' }` : `{ kind: 'person', name: '${name}' }`));
  await setUp(`(R) => R.newGame([${[seats[0], seats[4], seats[5]]}])`);
  for (const width of [390, 360, 320]) {
    await page.setViewportSize({ width, height: 700 });
    assert.equal(await clipped(), 0, `GHOST is cut off with three at the table at ${width}px`);
  }
  await setUp(`(R) => R.newGame([${seats}])`);
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await clipped(), 0, 'GHOST is cut off with six at the table on a laptop');
  await page.setViewportSize({ width: 390, height: 844 });
}

// A screen reader hears how many letters each player has, not G H O S T for everyone.
await setUp(`(R) => { const s = ${youAndWisp}; s.players[0].letters = 2; s.players[1].letters = 4; return s; }`);
{
  const heard = await page.locator('#players').ariaSnapshot();
  assert.match(heard, /You have G H$/m, heard);
  assert.match(heard, /Wisp has G H O S$/m, heard);
}

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

// If the big word list doesn't arrive (a dropped connection on a first visit), the game carries on without it.
{
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await ctx2.route('**/js/words-more.js', r => r.abort());
  const page2 = await ctx2.newPage();
  const uncaught = [];
  page2.on('pageerror', e => uncaught.push(e.message));
  await page2.goto(base);
  const set2 = fn => page2.evaluate(`ghostGame.set((${fn})(ghostGame.rules, ghostGame.dict))`);
  const wait2 = fn => page2.waitForFunction(fn, null, { timeout: 15000 });
  // Hollis still takes his turn.
  await set2(`(R) => ({ ...R.newGame([{ kind: 'person', name: 'You' }, { kind: 'ghost', ghost: 'hollis', name: 'Hollis' }]), frag: 'pl', last: 0, turn: 1 })`);
  await wait2(() => ghostGame.state().frag.length === 3 || ghostGame.state().phase !== 'play');
  // An everyday word still beats a challenge, and a rarer one can still be counted.
  await set2(`(R, d) => R.setExtra(R.challenge(['g', 'h', 'o'].reduce((st, c) => R.addLetter(st, c, d.endsRound), ${youAndWisp})), 'st')`);
  await page2.click('#done');
  await wait2(() => !document.getElementById('result').hidden);
  assert.equal(await page2.locator('#resultWord').textContent(), 'GHOST');
  await set2(`(R) => R.setExtra(R.challenge({ ...${youAndWisp}, frag: 'qo', last: 0, turn: 1 }), 'ph')`);
  await page2.click('#done');
  await wait2(() => document.getElementById('countIt'));
  assert.deepEqual(uncaught, [], 'errors without the big word list');
  await ctx2.close();
}

// A damaged save (only a hand edit or a broken disk makes one) doesn't stop the page: it starts from the defaults.
{
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page3 = await ctx3.newPage();
  const uncaught = [];
  page3.on('pageerror', e => uncaught.push(e.message));
  await page3.goto(base);
  const twoAtTable = '[{"kind":"person","name":"You","letters":0},{"kind":"ghost","ghost":"wisp","name":"Wisp","letters":0}]';
  for (const [key, junk] of [
    ['table', 'null'], ['table', '{}'], ['table', '{"people":["You"],"ghosts":["casper","maud"]}'],
    ['record', 'null'], ['record', '{"wisp":5}'],
    ['game', '{"players":[1,2],"phase":"play"}'],
    ['game', `{"players":${twoAtTable},"round":1,"frag":"ab","turn":0,"last":1,"moves":[],"phase":"naming","challenge":null}`],
  ]) {
    await page3.evaluate(([k, v]) => { localStorage.clear(); localStorage.setItem(`ghost.${k}`, v); }, [key, junk]);
    await page3.reload();
    assert.equal(await page3.locator('#setup').isVisible(), true, `no table to set after ghost.${key} = ${junk}`);
    assert.doesNotMatch(await page3.locator('#ghostPicks').textContent(), /undefined/);
    await page3.click('#start', { timeout: 5000 });
    assert.equal(await page3.locator('#game').isVisible(), true, `couldn’t start a game after ghost.${key} = ${junk}`);
  }
  // A good save comes through as it is.
  await page3.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('ghost.table', '{"people":["Ann","Ben"],"ghosts":["maud"]}');
    localStorage.setItem('ghost.record', '{"maud":{"won":2,"lost":1}}');
  });
  await page3.reload();
  assert.deepEqual(await page3.locator('#people input').evaluateAll(els => els.map(e => e.value)), ['Ann', 'Ben']);
  assert.equal(await page3.locator('.ghost-pick.g-maud').getAttribute('aria-pressed'), 'true');
  assert.match(await page3.locator('.ghost-pick.g-maud').textContent(), /2 won, 1 lost/);
  assert.deepEqual(uncaught, [], 'errors from a damaged save');
  await ctx3.close();
}

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while playing');
await browser.close();
server.close();
console.log('all good');
