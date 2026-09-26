// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// Math.random is seeded, so the same pictures come out every time.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
let UPNG = null;
try { UPNG = require('upng-js'); } catch {}
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
const SEED = 4;
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

// Screenshots are saved with a 256-colour palette when upng-js is installed (npm install), which keeps them small.
async function save(buffer, file) {
  if (UPNG) {
    const img = UPNG.decode(buffer);
    buffer = Buffer.from(UPNG.encode(UPNG.toRGBA8(img), img.width, img.height, 256));
  }
  await writeFile(join(root, file), buffer);
}

async function open(viewport, deviceScaleFactor, storage = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: viewport.width < 600, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(([seed, storage]) => {
    let a = seed; // mulberry32
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    if (!sessionStorage.getItem('seeded')) {
      localStorage.clear();
      for (const [k, v] of Object.entries(storage)) localStorage.setItem(`ghost.${k}`, JSON.stringify(v));
      sessionStorage.setItem('seeded', '1');
    }
  }, [SEED, storage]);
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

// Build a game position with the real rules, in the page.
const setUp = (page, fn) => page.evaluate(`ghostGame.set((${fn})(ghostGame.rules, ghostGame.dict))`);
const people = (...names) => names.map(name => `{ kind: 'person', name: '${name}' }`);
const ghosts = (...ids) => ids.map(id => `{ kind: 'ghost', ghost: '${id}', name: '${id[0].toUpperCase() + id.slice(1)}' }`);

// A round in progress: Hollis just added O, and your finger is on M.
async function midRound(page) {
  await setUp(page, `(R, d) => {
    let s = R.newGame([${[...people('You'), ...ghosts('maud', 'hollis')]}]);
    s.players[0].letters = 1; s.players[1].letters = 2;
    s = { ...s, round: 4 };
    for (const c of 'phanto') s = R.addLetter(s, c, d.endsRound);
    return s;
  }`);
  await page.waitForTimeout(600);
}

async function press(page, letter) {
  const box = await page.locator(`.letter[data-letter="${letter}"]`).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
}

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await midRound(page);
  await press(page, 'm');
  await save(await page.screenshot(), 'docs/phone-play.png');
  await page.mouse.up();
  await page.context().close();
}
{
  // You challenged Hollis on ZYG. Hollis spells it out.
  const page = await open({ width: 390, height: 844 }, 2);
  await setUp(page, `(R, d) => {
    let s = R.newGame([${[...people('You'), ...ghosts('hollis')]}]);
    s.players[1].letters = 1;
    s = { ...s, round: 3, frag: 'zy', turn: 1, last: 0 };
    s = R.addLetter(s, 'g', d.endsRound);
    return R.challenge(s);
  }`);
  // Catch it as the planchette settles on the T.
  await page.waitForFunction(() => ghostGame.state().challenge?.extra === 'o' && document.querySelector('.letter[data-letter="t"]').classList.contains('lit'), null, { timeout: 20000, polling: 'raf' });
  await save(await page.screenshot(), 'docs/phone-challenge.png');
  await page.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 20000 });
  await page.waitForTimeout(1600);
  await save(await page.screenshot(), 'docs/phone-result.png');
  await page.context().close();
}
// On a laptop: four at the table, and it's Sam's turn.
{
  const page = await open({ width: 1280, height: 800 }, 1);
  await setUp(page, `(R, d) => {
    let s = R.newGame([${[...people('Mark', 'Sam'), ...ghosts('wisp', 'maud')]}]);
    s.players[1].letters = 3; s.players[2].letters = 1; s.players[3].letters = 2;
    s = { ...s, round: 7 };
    for (const c of 'poltergei') s = R.addLetter(s, c, d.endsRound);
    return s;
  }`);
  await page.waitForTimeout(600);
  await press(page, 's');
  await save(await page.screenshot(), 'docs/desktop.png');
  await page.mouse.up();
  await page.context().close();
}

// Link preview, 1200 x 630: a card with the name on the left and the real board on the right.
{
  const page = await open({ width: 640, height: 900 }, 2);
  await midRound(page);
  await press(page, 'm');
  const board = (await page.locator('.board').screenshot({ omitBackground: true })).toString('base64');
  const ghostArt = await page.evaluate(() => import('./js/art.js').then(m => ['wisp', 'maud', 'hollis'].map(id => m.ghostSvg(id))));
  const font = async f => (await readFile(join(root, 'fonts', f))).toString('base64');
  const card = await open({ width: 1200, height: 630 }, 1);
  await card.setContent(`<!doctype html><style>
    @font-face { font-family: Cinzel; src: url(data:font/woff2;base64,${await font('cinzel.woff2')}); font-weight: 400 900; }
    @font-face { font-family: Garamond; src: url(data:font/woff2;base64,${await font('eb-garamond.woff2')}); font-weight: 400 800; }
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
    body {
      background: radial-gradient(70% 90% at 78% 70%, #2d2436 0%, rgba(26, 22, 36, 0) 70%), radial-gradient(60% 60% at 18% 30%, rgba(200, 214, 255, .09), rgba(0,0,0,0) 70%), #13111c;
      color: #ede5d3; font-family: Garamond, serif; position: relative;
      --sheet: #e7edfb; --eye: #232033; --bow: #c77b8f; --hat: #232033; --band: #8c6bb0;
    }
    .left { position: absolute; left: 80px; top: 118px; width: 470px; }
    .ghosts { display: flex; gap: 18px; align-items: flex-end; height: 92px; margin-bottom: 8px; }
    .ghosts svg { width: 60px; filter: drop-shadow(0 0 12px rgba(190, 212, 255, .55)); }
    .ghosts svg:nth-child(2) { width: 74px; margin-bottom: 14px; }
    h1 { font-family: Cinzel; font-weight: 700; font-size: 112px; letter-spacing: .1em; margin: 0; line-height: 1; text-shadow: 0 0 36px rgba(190, 212, 255, .55); }
    p { font-size: 34px; line-height: 1.25; color: #c9c0b1; margin: 22px 0 0; }
    .word { position: absolute; left: 610px; width: 540px; top: 46px; text-align: center; font-family: Cinzel; font-weight: 700; font-size: 76px; letter-spacing: .08em; text-shadow: 0 0 24px rgba(237, 229, 211, .25); }
    .word i { font-style: normal; color: #cfe0ff; opacity: .6; }
    .board { position: absolute; left: 610px; top: 150px; width: 540px; filter: drop-shadow(0 24px 50px rgba(0,0,0,.6)); }
  </style>
  <div class="left"><div class="ghosts">${ghostArt.join('')}</div>
  <h1>Ghost</h1><p>The old spelling game, played on a spirit board against three ghosts or your friends.</p></div>
  <div class="word">PHANTO<i>M</i></div>
  <img class="board" src="data:image/png;base64,${board}">`);
  await card.evaluate(() => document.fonts.ready);
  await card.waitForTimeout(200);
  await save(await card.screenshot(), 'og.png');
  await card.context().close();
  await page.context().close();
}

await browser.close();
server.close();
console.log('screenshots written');
