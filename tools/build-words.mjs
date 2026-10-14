// Rebuilds the word lists in js/words-ends.js and js/words-more.js:  node tools/build-words.mjs
// Downloads its sources into tools/.cache the first time (needs curl, tar and unzip):
//   SCOWL 2020.12.07 by Kevin Atkinson, http://wordlist.aspell.net/ (MIT-style licence, see its Copyright file)
//   12dicts 6.0.2 by Alan Beale, http://wordlist.aspell.net/12dicts/ (public domain)
//   ENABLE, the word list used by many word games (public domain)
//   The List of Dirty, Naughty, Obscene and Otherwise Bad Words (CC BY 4.0),
//   https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words, used only as a filter
//
// Two lists come out:
//   ends:  words that end the round when someone spells them. SCOWL size 50 (a normal spell checker's list),
//          four letters or longer, kept only if 12dicts or ENABLE agree it's a word, and only the ones you can
//          actually reach: "players" can never be spelled, because the round ends at "play".
//          Each is marked with how common it is (SCOWL size 35 or not).
//   more:  everything else that counts when you're challenged and have to name a word:
//          SCOWL size 70, 12dicts and ENABLE together.
// Words on the filter list are left out of both, so they never end a round, never count, and a ghost never says one.
// So are the rude words made from them, slurs the list doesn't have (RUDE, SLURS and STARTS below), and rarer words a
// ghost could only reach by spelling one of those first (spellsFirst). Other words that start with one are ordinary words.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from '../js/packed.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, 'tools/.cache');
mkdirSync(cache, { recursive: true });

const SOURCES = {
  'scowl.tar.gz': 'https://sourceforge.net/projects/wordlist/files/SCOWL/2020.12.07/scowl-2020.12.07.tar.gz/download',
  '12dicts.zip': 'https://sourceforge.net/projects/wordlist/files/12Dicts/6.0/12dicts-6.0.2.zip/download',
  'enable1.txt': 'https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt',
  'filter.txt': 'https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en',
};
for (const [file, url] of Object.entries(SOURCES)) {
  if (!existsSync(join(cache, file))) execSync(`curl -sSL -o "${join(cache, file)}" "${url}"`, { stdio: 'inherit' });
}
if (!existsSync(join(cache, 'scowl-2020.12.07'))) execSync('tar xzf scowl.tar.gz', { cwd: cache });
if (!existsSync(join(cache, '12dicts'))) execSync('unzip -q -o 12dicts.zip -d 12dicts', { cwd: cache });

const clean = text => text.split(/\r?\n/).map(w => w.trim().replace(/[%$!&+^=]+$/, '')).filter(w => /^[a-z]+$/.test(w));
const read = (p, enc = 'utf8') => readFileSync(join(cache, p), enc);

function scowl(size) {
  const out = new Set();
  for (const part of ['english-words', 'american-words']) {
    for (const s of [10, 20, 35, 40, 50, 55, 60, 70]) {
      const p = `scowl-2020.12.07/final/${part}.${s}`;
      if (s <= size && existsSync(join(cache, p))) for (const w of clean(read(p, 'latin1'))) out.add(w);
    }
  }
  return out;
}

// Plenty of ordinary words start with a word on the filter list: assume, title, button, cocktail, analysis, scatter, spice.
// Those are kept. These are the rude ones, and the slurs the list doesn't have, left out like the list's own words: the
// words in RUDE and SLURS, and every word that starts with one in STARTS. A word is also left out when it's one of them
// with -s, -es or -ies on the end.
const RUDE = ['anality', 'anally', 'asslike', 'boobie', 'buttock', 'cockish', 'cockup', 'cummed', 'cummer', 'cumshaw', 'dicked',
  'dickey', 'dickie', 'dickier', 'dickiest', 'dicking', 'dicky', 'mongo', 'mongoe', 'raped', 'raper', 'sext', 'spick', 'spunked',
  'spunkie', 'spunking', 'tittie'];
const SLURS = ['abo', 'boche', 'cholo', 'coolie', 'dago', 'darkey', 'darky', 'dyke', 'dyked', 'dykey', 'dyking', 'golliwog', 'golliwogg',
  'gollywog', 'gook', 'gyp', 'gypped', 'gypper', 'gypping', 'gypsied', 'gypsy', 'hebe', 'homo', 'honky', 'kaffir', 'kafir', 'kraut',
  'lezzie', 'lubra', 'mick', 'mulatto', 'octoroon', 'peckerwood', 'pickaninny', 'quadroon', 'redskin', 'sambo', 'shiksa', 'shikse',
  'spaz', 'spazzes', 'squaw', 'whitey', 'whities', 'wog', 'wop', 'yid'];
const STARTS = ['autoerotic', 'bareback', 'bastard', 'bastinado', 'bitch', 'bullshit', 'clitor', 'cocksuck', 'coprophil',
  'dickhead', 'dildo', 'erotic', 'eunuch', 'fagg', 'fagin', 'fago', 'fellatio', 'fuck', 'gangbang', 'grope', 'gypsy', 'homoerotic',
  'incest', 'masturbat', 'mongol', 'negroid', 'negrophob', 'nigga', 'nigger', 'nipple', 'nude', 'nympho', 'orgasm', 'pantyliner',
  'pooft', 'porn', 'retard', 'scatolog', 'sexed', 'sexie', 'sexil', 'sexin', 'sexless', 'sexolog', 'sexploit', 'sexpot',
  'sexting', 'sexual', 'shit', 'slut', 'smutt', 'sodomiz', 'spastic', 'topless', 'twat', 'vagina', 'voyeur', 'vulva', 'wank',
  'whore'];

const filter = new Set([...clean(read('filter.txt')), ...RUDE, ...SLURS]);
const filtered = w => filter.has(w) || (w.endsWith('s') && filter.has(w.slice(0, -1))) || (w.endsWith('es') && filter.has(w.slice(0, -2)))
  || (w.endsWith('ies') && filter.has(`${w.slice(0, -3)}y`)) || STARTS.some(start => w.startsWith(start));

const s35 = scowl(35), s50 = scowl(50), s70 = scowl(70);
const enable = new Set(clean(read('enable1.txt')));
const dicts = new Set(clean(read('12dicts/American/2of12inf.txt')));

const long = w => w.length >= 4;
const ends = [...s50].filter(w => long(w) && (enable.has(w) || dicts.has(w) || s35.has(w)) && !filtered(w)).sort();
const endSet = new Set(ends);
const reachable = ends.filter(w => {
  for (let k = 4; k < w.length; k++) if (endSet.has(w.slice(0, k))) return false;
  return true;
});
const reachSet = new Set(reachable);
const endLines = reachable.map(w => w + (s35.has(w) ? '' : '+'));

// A rarer word is left out too when the only way to it spells one of the words left out above, so a cornered ghost never
// spells COON, NEGRO or RAPE on the board on its way to COONSKIN, NEGRONI or RAPESEED. When words that end a round go the
// same way (SPIC, on the way to SPICE) or a shorter word ends the round first (PUSS, before PUSSYCAT), it stays.
const inPlay = new Set(reachable.flatMap(w => [...w].map((c, k) => w.slice(0, k + 1))));
const spellsFirst = w => {
  for (let k = 3; k < w.length; k++) {
    const start = w.slice(0, k);
    if (reachSet.has(start)) return false;
    if (!inPlay.has(start) && filtered(start)) return true;
  }
  return false;
};

const more = [...new Set([...s70, ...enable, ...dicts])]
  .filter(w => long(w) && !reachSet.has(w) && !filtered(w) && !spellsFirst(w))
  .sort();

const header = what => `// Generated by tools/build-words.mjs: ${what}\n// Front-coded (see js/packed.js). SCOWL, 12dicts and ENABLE; see README.md for credits.\n`;
const write = (file, what, text) => {
  // A template literal is safe: the text is only letters and the characters '0' to 'Z'.
  writeFileSync(join(root, file), `${header(what)}export default \`\n${text}\n\`;\n`);
  console.log(`${file}: ${(text.length / 1024).toFixed(0)} KB`);
};
write('js/words-ends.js', `the ${reachable.length} words that end a round. No mark: everyday; +: less common.`, encode(endLines));
write('js/words-more.js', `${more.length} more words that count when you name one after a challenge.`, encode(more));
console.log(`${reachable.length} round-ending words (${endLines.filter(l => !l.endsWith('+')).length} everyday), ${more.length} more`);
