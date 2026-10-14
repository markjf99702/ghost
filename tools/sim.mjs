// How often people beat each ghost, and how the ghosts do against each other:  node tools/sim.mjs [--games 200] [--seed 1]
// Plays the game's own rules.js and ghosts.js, so it shows what changing a ghost's dials in ghosts.js does.
//
// Two kinds of person, both rough models:
//   beginner: knows the everyday words, heads for one of them at random and doesn't count whose turn it will be
//             when the word is finished.
//   careful:  knows the everyday words and about half the less common ones, and picks the letter that most often
//             leaves someone else to finish a word. Opens with one of six good letters.
// Each challenges when it knows no word that fits, bluffs when stuck, and owns up when its bluff is called.
// The person starts round 1, as in the app.
import * as dict from '../js/dict.js';
import * as R from '../js/rules.js';
import { GHOSTS, chooseMove, nameWord } from '../js/ghosts.js';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? +process.argv[i + 1] : fallback; };
const GAMES = arg('games', 200);
const SEED = arg('seed', 1);

// The same small generator as the unit test.
function seeded(seed) {
  let a = seed;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// A fixed 0..1 number for each word, for "this person happens to know this word".
function hash01(word) {
  let h = 2166136261 ^ 7;
  for (let i = 0; i < word.length; i++) { h ^= word.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const pick = (list, rnd) => list[Math.floor(rnd() * list.length)];
function pickWeighted(list, weight, rnd) {
  let r = rnd() * list.reduce((t, o) => t + weight(o), 0);
  for (const o of list) if ((r -= weight(o)) < 0) return o;
  return list[list.length - 1];
}
const FREQ = { e: 12, t: 9, a: 8, o: 8, i: 7, n: 7, s: 6, h: 6, r: 6, d: 4, l: 4, c: 3, u: 3, m: 2, w: 2, f: 2, g: 2, y: 2, p: 2, b: 1, v: 1, k: 1, j: 0.2, x: 0.2, q: 0.1, z: 0.1 };

// A person who knows the round-ending words `knows(word, kind)` says yes to.
function person(knows, { careful }) {
  // For every node: how many known words lie below it, by length. And which nodes are known words.
  const below = new Map(), known = new Set();
  (function walk(node, word) {
    const m = new Map();
    if (node.e && knows(word, node.e)) { known.add(node); m.set(word.length, 1); }
    for (const c in node.k) for (const [len, k] of walk(node.k[c], word + c)) m.set(len, (m.get(len) || 0) + k);
    below.set(node, m);
    return m;
  })(dict.root, '');
  const total = node => { let t = 0; for (const k of below.get(node).values()) t += k; return t; };

  function move(s, rnd) {
    const frag = s.frag;
    const node = dict.nodeAt(frag);
    if (!(node && total(node)) && R.canChallenge(s)) return { challenge: true };
    const n = R.playersIn(s);
    const options = [];
    for (const c in node?.k || {}) {
      const kid = node.k[c];
      const t = known.has(kid) ? 0 : total(kid);
      if (!t) continue;
      let good = 0; // known words someone else would have to finish
      for (const [len, k] of below.get(kid)) if ((len - 1 - frag.length) % n !== 0) good += k;
      options.push({ c, t, score: (good + 0.5) / (t + 1) });
    }
    if (options.length) {
      if (!careful || rnd() < 0.1) return { letter: pickWeighted(options, o => o.t, rnd).c };
      if (!frag) return { letter: pick([...options].sort((a, b) => b.score - a.score).slice(0, 6), rnd).c };
      const best = Math.max(...options.map(o => o.score));
      return { letter: pick(options.filter(o => o.score >= best - 1e-9), rnd).c };
    }
    // Stuck: every letter they know of spells a word. Bluff, or give in and spell one.
    const ends = Object.keys(node?.k || {}).filter(c => known.has(node.k[c]));
    if (!ends.length || rnd() < (careful ? 0.6 : 0.5)) {
      return { letter: pickWeighted(Object.keys(FREQ).filter(c => !ends.includes(c)), c => FREQ[c], rnd), bluff: true };
    }
    return { letter: pick(ends, rnd) };
  }

  // Challenged: the shortest known word that fits, or nothing after a bluff.
  function name(s) {
    const start = dict.nodeAt(s.frag);
    if (s.moves.at(-1)?.bluff || !start || !total(start)) return null;
    let level = [[start, s.frag]];
    while (level.length) {
      const next = [];
      for (const [node, word] of level) {
        if (known.has(node)) return word;
        for (const c in node.k) if (total(node.k[c])) next.push([node.k[c], word + c]);
      }
      level = next;
    }
    return null;
  }
  return { kind: 'person', move, name };
}

const ghost = g => ({ kind: 'ghost', ghost: g.id, move: (s, rnd) => chooseMove(g, s, rnd), name: s => nameWord(g, s.frag, s.moves.at(-1)) });

// One game to the end (or one round, when only ghosts play). Returns the final state.
function play(seats, rnd) {
  let s = R.newGame(seats.map((p, i) => ({ kind: p.kind, ghost: p.ghost, name: `${p.kind}${i}` })));
  for (let steps = 0; steps < 20000 && s.phase !== 'done'; steps++) {
    if (s.phase === 'over') s = R.nextRound(s);
    else if (s.phase === 'play') {
      const m = seats[s.turn].move(s, rnd);
      s = m.challenge ? R.challenge(s) : R.addLetter(s, m.letter, dict.endsRound, m.bluff ? { bluff: true } : m.rare ? { rare: true } : {});
    } else {
      const w = seats[s.challenge.of].name(s);
      s = w && dict.isWord(w) ? R.nameWord(s, w, true) : R.giveUp(s);
    }
  }
  if (s.phase !== 'done') throw new Error(`a game didn't finish: ${JSON.stringify(s).slice(0, 300)}`);
  return s;
}

await dict.loadMore();
const people = {
  beginner: person((w, kind) => kind === 1, { careful: false }),
  careful: person((w, kind) => kind === 1 || hash01(w) < 0.5, { careful: true }),
};
const pct = (a, b) => `${Math.round((100 * a) / b)}%`.padStart(7);

console.log(`The person's wins in ${GAMES} games against each ghost (seed ${SEED}):`);
console.log(`${''.padEnd(10)}${GHOSTS.map(g => g.name.padStart(7)).join('')}`);
for (const [j, [who, p]] of Object.entries(people).entries()) {
  const row = GHOSTS.map((g, k) => {
    const rnd = seeded(SEED * 1000 + j * 10 + k);
    let won = 0;
    for (let i = 0; i < GAMES; i++) if (play([p, ghost(g)], rnd).winner === 0) won++;
    return pct(won, GAMES);
  });
  console.log(`${who.padEnd(10)}${row.join('')}`);
}

console.log(`\nGhost against ghost, ${GAMES} single rounds each way: how often the first loses the round.`);
for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
  const rnd = seeded(SEED * 1000 + 500 + a * 10 + b);
  let lost = 0;
  for (let i = 0; i < GAMES; i++) {
    if (play([ghost(GHOSTS[a]), ghost(GHOSTS[b])], rnd).players[0].letters) lost++;
    if (play([ghost(GHOSTS[b]), ghost(GHOSTS[a])], rnd).players[1].letters) lost++;
  }
  console.log(`${GHOSTS[a].name} against ${GHOSTS[b].name}: ${GHOSTS[a].name} loses ${pct(lost, 2 * GAMES).trim()}`);
}
