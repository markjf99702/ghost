// The rules, the dictionary and the ghosts, without a page:  node --test test/unit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as dict from '../js/dict.js';
import * as R from '../js/rules.js';
import { GHOSTS, ghostById, chooseMove, nameWord } from '../js/ghosts.js';
import { encode, decode } from '../js/packed.js';

await dict.loadMore();

// A tiny random number generator, so the ghost games come out the same every run.
function seeded(seed) {
  let a = seed;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const two = (a = { kind: 'person', name: 'You' }, b = { kind: 'ghost', ghost: 'wisp', name: 'Wisp' }) => R.newGame([a, b]);
const play = (s, letters) => [...letters].reduce((st, c) => R.addLetter(st, c, dict.endsRound), s);

test('front coding round-trips', () => {
  const words = ['ghost', 'ghostly', 'ghosts', 'ghoul', 'goblin'];
  assert.deepEqual(decode(encode(words)), words);
  assert.equal(encode(['ghost', 'ghostly', 'ghosts']), '0ghost\n5ly\n5s', 'the example in js/packed.js');
});

test('the round-ending words: four letters or more, and only ones you can reach', () => {
  assert.ok(dict.endsRound('ghost'));
  assert.ok(dict.endsRound('play'));
  assert.equal(dict.endsRound('cat'), 0, 'three-letter words never end a round');
  assert.equal(dict.nodeAt('player'), null, 'the round ends at play, so player is never reached');
  assert.equal(dict.endsRound('ghos'), 0);
});

test('naming a word: rare words count, and so do words past a shorter one', () => {
  assert.ok(dict.isWord('ghostly'), 'longer than ghost, but still a word');
  assert.ok(dict.isWord('player'));
  assert.ok(dict.isWord('qoph'), 'a Scrabble word from the big list');
  assert.ok(!dict.isWord('ghostz'));
  assert.ok(!dict.isWord('cat'), 'too short');
  assert.ok(dict.anyWordStarts('xylo'));
  assert.ok(!dict.anyWordStarts('qx'));
});

test('an example word is short and common', () => {
  assert.equal(dict.exampleWord('gho'), 'ghost');
  assert.equal(dict.exampleWord('qx'), null);
  assert.equal(dict.exampleWord('him'), 'himself', 'not HIMS');
});

test('words hardly anyone says don’t end a round just before a common one, and still count when named', () => {
  for (const [rare, common] of [['belie', 'believe'], ['hims', 'himself'], ['leas', 'least'], ['finis', 'finish'], ['posit', 'position'],
    ['viol', 'violin'], ['awes', 'awesome'], ['pries', 'priest'], ['sough', 'sought'], ['fount', 'fountain']]) {
    assert.equal(dict.endsRound(rare), 0, `${rare} ends a round`);
    assert.ok(dict.isWord(rare), `${rare} doesn’t count when named`);
    assert.ok(dict.endsRound(common), `${common} doesn’t end a round`);
  }
  for (const w of ['firs', 'pare']) assert.ok(dict.endsRound(w), `${w} doesn’t end a round`);
  // Nothing comes after KENNED, so it still ends a round. In the big list it would leave the next player stuck.
  assert.ok(dict.endsRound('kenned'), 'KENNED doesn’t end a round');
});

test('words that only start with a rude word are ordinary words, and rude words made from one are left out', () => {
  for (const w of ['assume', 'title', 'button', 'cocktail', 'analysis', 'scatter', 'spice', 'sucker', 'sextant']) {
    assert.ok([1, 2].includes(dict.endsRound(w)), `${w} isn't an ordinary round-ending word`);
  }
  for (const w of ['fucked', 'bitchy', 'whorehouse', 'cocksucker', 'sexy', 'orgies', 'pussies']) assert.ok(!dict.isWord(w), `${w} counts`);
});

test('slurs the filter list misses are left out too, so a ghost never names one', () => {
  for (const w of ['dyke', 'dykes', 'gook', 'gyps', 'gypped', 'mulatto', 'squaw', 'retard', 'retarded', 'dago', 'dagoes', 'wops', 'yids',
    'wogs', 'sambo', 'spaz', 'hebe', 'golliwog', 'abos', 'kraut', 'redskin', 'pickaninnies']) assert.ok(!dict.isWord(w), `${w} counts`);
  // Words made from them, which once DYKE and GYPS stopped cutting them off a cornered ghost could reach and name.
  for (const w of ['dykey', 'gypsydom', 'gypsyish', 'gypsyism', 'gypsying', 'gypsied']) assert.ok(!dict.isWord(w), `${w} counts`);
  for (const w of ['kaffir', 'kafirs', 'boche', 'lubra', 'micks', 'shiksa', 'shikse', 'cholo']) assert.ok(!dict.isWord(w), `${w} counts`);
  assert.ok(dict.endsRound('squawk'), 'SQUAW no longer cuts off SQUAWK');
});

test('a few vulgar words are left out as well, and QUEER and SPOOK are still ordinary words', () => {
  for (const w of ['crap', 'piss', 'turd', 'bugger', 'sodding', 'sodomite', 'arses', 'cooch', 'weiner', 'turds', 'buggered']) {
    assert.ok(!dict.isWord(w), `${w} counts`);
  }
  for (const w of ['queer', 'spook']) assert.ok([1, 2].includes(dict.endsRound(w)), `${w} doesn’t end a round`);
});

test('a cornered ghost never spells a word that’s left out on its way to a rarer one', () => {
  // Heading for COONSKIN, NEGRONI or RAPESEED, Hollis would spell COON, NEGRO or RAPE on the board, so those go too.
  for (const start of ['butts', 'clit', 'coon', 'dago', 'dicky', 'fag', 'gook', 'hebe', 'mick', 'milf', 'mongs', 'negro', 'poof', 'rape',
    'skeet', 'smut']) assert.equal(dict.anyWordStarts(start), false, `a word starts with ${start}`);
  // They stay where words that end a round go the same way (SPIC, then SPICE), or a shorter one ends it first (PUSS).
  for (const w of ['spicebush', 'pussycat']) assert.ok(dict.isWord(w), `${w} doesn’t count`);
});

test('no letters lead only to words the ghosts won’t use, and the card can always show a word that was there', () => {
  // Such letters were a trap: after ASS or TIT, Wisp challenged and lost to ASSUME or TITLE, Maud and Hollis bluffed and
  // owned up, and the card said there was no word.
  const traps = [], blank = [];
  (function walk(node, frag) {
    if (!(node.r & dict.KNOWN)) traps.push(frag);
    if (frag.length >= 2 && !node.e && !dict.exampleWord(frag)) blank.push(frag);
    for (const c in node.k) walk(node.k[c], frag + c);
  })(dict.root, '');
  assert.deepEqual(traps, [], 'letters only rude or never-said words start with');
  assert.deepEqual(blank, [], 'letters a word starts with, but the card would say there isn’t one');
});

test('word list files are generated and complete', async () => {
  const ends = await readFile(new URL('../js/words-ends.js', import.meta.url), 'utf8');
  assert.match(ends, /Generated by tools\/build-words\.mjs/);
  let count = 0;
  (function walk(n) { if (n.e) count++; for (const c in n.k) walk(n.k[c]); })(dict.root);
  assert.ok(count > 15000, `only ${count} round-ending words`);
});

test('How to play says how many words end a round, and that they aren’t all everyday ones', async () => {
  const kinds = { 1: 0, 2: 0 };
  (function walk(n) { if (n.e) kinds[n.e]++; for (const c in n.k) walk(n.k[c]); })(dict.root);
  const help = (await readFile(new URL('../index.html', import.meta.url), 'utf8')).match(/<p>([^<]*words end a round[^<]*)<\/p>/)[1];
  const about = `About ${(Math.round((kinds[1] + kinds[2]) / 1000) * 1000).toLocaleString('en-US')} words end a round`;
  assert.ok(help.startsWith(about), `the help says “${help}”, but ${kinds[1] + kinds[2]} words end a round`);
  assert.ok(kinds[2] > 0 && /less common/.test(help), `${kinds[2]} less common words end a round too`);
});

test('the installed app stays upright: held sideways, the word and the board don’t fit on the screen together', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.orientation, 'portrait');
});

test('spelling a word ends the round, and the speller takes a letter', () => {
  let s = two();
  s = play(s, 'ghos');
  assert.equal(s.phase, 'play');
  assert.equal(s.turn, 0);
  s = R.addLetter(s, 't', dict.endsRound);
  assert.equal(s.phase, 'over');
  assert.equal(s.result.why, 'spelled');
  assert.equal(s.result.loser, 0);
  assert.equal(s.players[0].letters, 1);
  s = R.nextRound(s);
  assert.equal(s.frag, '');
  assert.equal(s.turn, 0, 'the loser starts the next round');
  assert.equal(s.round, 2);
});

test('a game can start with any seat, and games saved before the opener was kept still load', () => {
  const s = R.newGame([{ kind: 'person', name: 'Ann' }, { kind: 'person', name: 'Ben' }, { kind: 'ghost', ghost: 'wisp', name: 'Wisp' }], 1);
  assert.deepEqual([s.turn, s.last, s.round, s.opener], [1, -1, 1, 1], 'Ben opens round 1');
  assert.equal(two().turn, 0, 'the first seat opens unless told otherwise');
  assert.ok(R.isGame(s));
  const { opener, ...old } = s;
  assert.ok(R.isGame(old), 'a game saved before the opener was kept is set aside');
  for (const bad of [3, -1, 'x', null]) assert.equal(R.isGame({ ...s, opener: bad }), false, `opener ${bad} passes`);
});

test('challenges: a named word beats the challenge, giving up loses', () => {
  let s = play(two(), 'gh');
  assert.ok(R.canChallenge(s));
  s = R.challenge(s);
  assert.equal(s.phase, 'naming');
  assert.deepEqual([s.challenge.by, s.challenge.of], [0, 1]);
  const failed = R.nameWord(s, 'ghostly', true);
  assert.equal(failed.result.loser, 0, 'the challenger loses when a word is named');
  const wrong = R.nameWord(s, 'ghzz', false);
  assert.equal(wrong.phase, 'naming', 'a word that doesn’t count can be fixed');
  assert.equal(wrong.challenge.wrong, 'ghzz');
  const bluff = R.giveUp(wrong);
  assert.equal(bluff.result.loser, 1);
  assert.equal(bluff.result.why, 'bluff');
});

test('you can’t challenge a single letter, or yourself', () => {
  const s = play(two(), 'g');
  assert.ok(!R.canChallenge(s));
  assert.equal(R.challenge(s), s);
});

test('five letters and you are out; the last one left wins', () => {
  let s = R.newGame([{ kind: 'person', name: 'A' }, { kind: 'person', name: 'B' }, { kind: 'ghost', ghost: 'maud', name: 'Maud' }]);
  s = { ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, letters: 4 } : p)) };
  s = play(s, 'ghost'); // A g, B h, Maud o, A s, B t
  assert.equal(s.result.loser, 1);
  assert.equal(s.phase, 'over', 'two players are still in');
  s = R.nextRound(s);
  assert.equal(s.turn, 2, 'B is out, so the next player starts');
  assert.equal(R.nextIn(s, 2), 0, 'and B is skipped');
  s = { ...s, turn: 0, players: s.players.map((p, i) => (i === 0 ? { ...p, letters: 4 } : p)) };
  s = play(s, 'ghost'); // A g, Maud h, A o, Maud s, A t
  assert.equal(s.phase, 'done');
  assert.equal(s.winner, 2);
});

test('the game ends when the people are all out, even with ghosts left', () => {
  let s = R.newGame([{ kind: 'person', name: 'You' }, { kind: 'ghost', ghost: 'wisp', name: 'Wisp' }, { kind: 'ghost', ghost: 'maud', name: 'Maud' }]);
  s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, letters: 4 } : p)) };
  s = play(s, 'play'); // You p, Wisp l, Maud a, You y
  assert.equal(s.result.loser, 0);
  assert.equal(s.phase, 'done');
  assert.equal(s.winner, -1, 'only ghosts are left');
});

test('a game saved at any point can be picked up again, and a damaged save is set aside', () => {
  const rnd = seeded(5);
  const saved = s => JSON.parse(JSON.stringify(s));
  const seen = new Set();
  for (let game = 0; game < 6; game++) {
    let s = R.newGame([{ kind: 'person', name: 'You' }, { kind: 'ghost', ghost: 'wisp', name: 'Wisp' }, { kind: 'ghost', ghost: 'hollis', name: 'Hollis' }]);
    const brain = i => ghostById(s.players[i].ghost || 'maud'); // you play like Maud
    const check = () => { seen.add(s.phase); assert.ok(R.isGame(saved(s)), `set aside: ${JSON.stringify(s).slice(0, 300)}`); };
    for (let steps = 0; s.phase !== 'done' && steps < 3000; steps++) {
      check();
      if (s.phase === 'over') { seen.add(s.result.why); s = R.nextRound(s); continue; }
      if (s.phase === 'play') {
        const m = chooseMove(brain(s.turn), s, rnd);
        s = m.challenge ? R.challenge(s) : R.addLetter(s, m.letter, dict.endsRound, m.bluff ? { bluff: true } : m.rare ? { rare: true } : {});
        continue;
      }
      // Challenged: a wrong try first, then the real word a letter at a time, or give up.
      const w = nameWord(brain(s.challenge.of), s.frag, s.moves.at(-1));
      if (!w) { s = R.giveUp(s); continue; }
      s = R.nameWord(R.setExtra(s, 'zz'), `${s.frag}zz`, false);
      check();
      s = R.setExtra(s, '');
      for (const c of w.slice(s.frag.length)) { s = R.setExtra(s, s.challenge.extra + c); check(); }
      s = R.nameWord(s, w, true);
    }
    check();
    seen.add(s.result.why);
    assert.ok(R.isGame(saved({ ...s, recorded: true })));
  }
  assert.deepEqual([...seen].sort(), ['bluff', 'done', 'named', 'naming', 'over', 'play', 'spelled'], 'every kind of state came up');

  const good = R.challenge(play(two(), 'gh'));
  assert.ok(R.isGame(good));
  const junk = [
    null, 'null', 3, [], {}, { players: 'ab' }, { ...good, players: [] }, { ...good, players: [null, null] },
    { ...good, frag: 7 }, { ...good, frag: 'GH' }, { ...good, moves: null }, { ...good, turn: 5 }, { ...good, phase: 'thinking' },
    { ...good, challenge: null }, { ...good, challenge: { ...good.challenge, of: 9 } }, { ...R.giveUp(good), result: null },
    { ...R.giveUp(good), challenge: null }, { ...R.giveUp(good), phase: 'done', winner: 7 },
  ];
  for (const j of junk) assert.equal(R.isGame(j), false, JSON.stringify(j));
});

test('ghosts challenge letters that can’t become a word', () => {
  const s = play(two(), 'qx');
  for (const g of GHOSTS) assert.deepEqual(chooseMove(g, { ...s, turn: 1, last: 0 }, seeded(1)), { challenge: true }, g.name);
});

test('ghosts never spell a word when there’s a safe letter', () => {
  const rnd = seeded(7);
  for (const frag of ['', 'g', 'gh', 'ghos', 'pla', 'qui', 'zeb', 'tran']) {
    for (const g of GHOSTS) {
      for (let k = 0; k < 10; k++) {
        const s = { ...play(two(), frag), turn: 1, last: frag ? 0 : -1 };
        const move = chooseMove(g, s, rnd);
        if (move.challenge) { assert.ok(frag.length >= 2); continue; }
        const next = frag + move.letter;
        const node = dict.nodeAt(frag);
        const hasSafe = node && Object.values(node.k).some(n => !n.e && n.r & g.knows);
        if (hasSafe) assert.equal(dict.endsRound(next), 0, `${g.name} spelled ${next}`);
      }
    }
  }
});

test('a challenged ghost names a real word, or owns up to a bluff', () => {
  for (const g of GHOSTS) {
    const w = nameWord(g, 'gho', {});
    assert.ok(w && w.startsWith('gho') && dict.isWord(w), `${g.name} named ${w}`);
    assert.equal(nameWord(g, 'gho', { bluff: true }), null);
  }
  assert.ok(dict.isWord(nameWord(ghostById('hollis'), 'mho', { rare: true })), 'Hollis can back up a rare word');
});

test('the ghosts play on after ASS, TIT or SEX, and back it up; after FUCK they challenge', () => {
  const rnd = seeded(3);
  for (const frag of ['ass', 'tit', 'butt', 'cock', 'anal', 'cum', 'sex', 'scat', 'spic', 'suck']) {
    for (const g of GHOSTS) {
      for (let k = 0; k < 20; k++) {
        const move = chooseMove(g, { ...play(two(), frag), turn: 1, last: 0 }, rnd);
        assert.ok(!move.challenge && !move.bluff, `${g.name} ${move.challenge ? 'challenged' : 'bluffed'} after ${frag}`);
        const w = nameWord(g, frag + move.letter, move);
        assert.ok(w && w.startsWith(frag + move.letter) && dict.isWord(w), `${g.name} couldn’t back up ${frag + move.letter}: ${w}`);
      }
    }
  }
  for (const g of GHOSTS) assert.deepEqual(chooseMove(g, { ...play(two(), 'fuck'), turn: 1, last: 0 }, rnd), { challenge: true }, g.name);
});

test('the hard ghost beats the easy one, and the easy one is beatable', () => {
  const rnd = seeded(42);
  const wins = { wisp: 0, hollis: 0 };
  for (let game = 0; game < 12; game++) {
    const order = game % 2 ? ['wisp', 'hollis'] : ['hollis', 'wisp'];
    let s = R.newGame(order.map(id => ({ kind: 'person', ghost: id, name: id })));
    for (let steps = 0; s.phase !== 'done' && steps < 2000; steps++) {
      if (s.phase === 'over') { s = R.nextRound(s); continue; }
      if (s.phase === 'play') {
        const m = chooseMove(ghostById(s.players[s.turn].ghost), s, rnd);
        s = m.challenge ? R.challenge(s) : R.addLetter(s, m.letter, dict.endsRound, m.bluff ? { bluff: true } : {});
      } else {
        const w = nameWord(ghostById(s.players[s.challenge.of].ghost), s.frag, s.moves.at(-1));
        s = w ? R.nameWord(s, w, dict.isWord(w)) : R.giveUp(s);
      }
    }
    wins[s.players[s.winner].ghost]++;
  }
  assert.ok(wins.hollis >= 10, `Hollis won ${wins.hollis} of 12`);
});
