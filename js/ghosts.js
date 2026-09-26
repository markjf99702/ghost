// The ghosts you can play against, and how they choose.
//
// A ghost looks at every letter it could add and works out, for the words it knows, who would end up having
// to finish one if everyone played sensibly from there. It picks a letter that leaves someone else stuck.
// How many words it knows, and how often it bothers to think it through, is what makes one easier than another.
import * as dict from './dict.js';
import { playersIn } from './rules.js';

export const GHOSTS = [
  {
    id: 'wisp', name: 'Wisp', level: 'Easy',
    about: 'Knows everyday words. Plays by feel and often walks into trouble.',
    knows: dict.EVERYDAY, sharp: 0.35, bluff: 0.3, deep: false,
  },
  {
    id: 'maud', name: 'Maud', level: 'Medium',
    about: 'Knows most words and usually thinks a move ahead.',
    knows: dict.KNOWN, sharp: 0.7, bluff: 0.45, deep: false,
  },
  {
    id: 'hollis', name: 'Hollis', level: 'Hard',
    about: 'Knows every word in the list, including ones you don’t, and plays to win.',
    knows: dict.KNOWN, sharp: 0.97, bluff: 0.6, deep: true,
  },
];
export const ghostById = id => GHOSTS.find(g => g.id === id);

// Does this ghost know a word that starts with these letters?
function knowsWordStarting(g, frag) {
  const node = dict.nodeAt(frag);
  if (g.knows === dict.EVERYDAY) return !!(node && node.r & dict.EVERYDAY);
  if (node && node.r & dict.ANY) return true;
  return g.deep && dict.moreStarting(frag, 1).length > 0;
}

// Does this ghost know that playing into this node spells a word? Wisp doesn't know the less common ones.
const knownEnd = (g, node) => node.e > 0 && (g.knows !== dict.EVERYDAY || node.e !== 2);

// For each position: the chance that each player loses the round, counting from the player about to move,
// if everyone picks the letter that is least likely to make them lose (ties shared equally).
const memos = new Map();
function odds(g, node, n) {
  const key = `${g.knows}/${n}`;
  if (!memos.has(key)) memos.set(key, new Map());
  const memo = memos.get(key);
  const hit = memo.get(node);
  if (hit) return hit;
  let best = Infinity, sum = null, ties = 0;
  for (const c in node.k) {
    const w = childOdds(g, node.k[c], n);
    if (!w) continue;
    if (w[0] < best - 1e-9) { best = w[0]; sum = w.slice(); ties = 1; }
    else if (w[0] <= best + 1e-9) { for (let i = 0; i < n; i++) sum[i] += w[i]; ties++; }
  }
  const out = sum ? sum.map(x => x / ties) : lose(n);
  memo.set(node, out);
  return out;
}

// The same, seen from the player who would play into `kid`; null if the ghost wouldn't consider it.
function childOdds(g, kid, n) {
  if (knownEnd(g, kid)) return lose(n);
  if (!(kid.r & g.knows)) return null;
  const u = odds(g, kid, n);
  const w = new Array(n);
  for (let i = 0; i < n; i++) w[i] = u[(i - 1 + n) % n];
  return w;
}

function lose(n) {
  const v = new Array(n).fill(0);
  v[0] = 1;
  return v;
}

const pick = (list, rnd) => list[Math.floor(rnd() * list.length)];
function pickWeighted(list, rnd) {
  const total = list.reduce((t, o) => t + o.weight, 0);
  let r = rnd() * total;
  for (const o of list) if ((r -= o.weight) < 0) return o;
  return list[list.length - 1];
}

// Letters that lead only to words outside the tree: rare words that don't end the round when spelled.
function rareWays(frag) {
  const out = [];
  for (const c of 'abcdefghijklmnopqrstuvwxyz') {
    const next = frag + c;
    const node = dict.nodeAt(next);
    if (dict.endsRound(next) || (node && node.r & dict.ANY)) continue;
    if (dict.moreStarting(next, 1, { forGhost: true }).length) out.push(c);
  }
  return out;
}

// English letter frequencies, for a bluff that looks like it might be going somewhere.
const FREQ = { e: 12, t: 9, a: 8, o: 8, i: 7, n: 7, s: 6, h: 6, r: 6, d: 4, l: 4, c: 3, u: 3, m: 2, w: 2, f: 2, g: 2, y: 2, p: 2, b: 1, v: 1, k: 1, j: 0.2, x: 0.2, q: 0.1, z: 0.1 };
function bluffLetter(g, frag, rnd) {
  const node = dict.nodeAt(frag);
  const options = Object.keys(FREQ)
    .filter(c => !(node?.k[c] && knownEnd(g, node.k[c])))
    .map(c => ({ c, weight: FREQ[c] }));
  return options.length ? pickWeighted(options, rnd).c : 'e';
}

/**
 * What the ghost does on its turn: { challenge: true } or { letter, bluff?, rare? }.
 * `bluff` means the ghost doesn't know any word that goes that way.
 */
export function chooseMove(g, s, rnd = Math.random) {
  const frag = s.frag;
  if (frag.length >= 2 && s.last >= 0 && !knowsWordStarting(g, frag)) return { challenge: true };

  const n = playersIn(s);
  const node = dict.nodeAt(frag);
  const safe = [];
  if (node) {
    for (const c in node.k) {
      const kid = node.k[c];
      if (knownEnd(g, kid) || !(kid.r & g.knows)) continue;
      safe.push({ c, loss: childOdds(g, kid, n)[0], weight: g.knows === dict.EVERYDAY ? kid.n1 : kid.n2 });
    }
  }

  if (safe.length) {
    const best = Math.min(...safe.map(o => o.loss));
    // Every sensible letter loses: Hollis heads for a word most people have never heard of.
    if (g.deep && best > 0.99 && rnd() < 0.6) {
      const rare = rareWays(frag);
      if (rare.length) return { letter: pick(rare, rnd), rare: true };
    }
    const pool = rnd() < g.sharp ? safe.filter(o => o.loss <= best + 1e-9) : safe;
    return { letter: pickWeighted(pool, rnd).c };
  }

  // Every letter it knows spells a word. Try a rare word, or bluff, or give in and spell one.
  if (g.deep || (g.knows === dict.KNOWN && rnd() < 0.5)) {
    const rare = rareWays(frag);
    if (rare.length) return { letter: pick(rare, rnd), rare: true };
  }
  const endings = node ? Object.keys(node.k).filter(c => knownEnd(g, node.k[c]) && node.k[c].e !== 3) : [];
  if (!endings.length || rnd() < g.bluff) return { letter: bluffLetter(g, frag, rnd), bluff: true };
  return { letter: pick(endings, rnd) };
}

/** The word a challenged ghost names, or null if it was bluffing. */
export function nameWord(g, frag, move) {
  if (move?.bluff) return null;
  return dict.exampleWord(frag, g.knows === dict.EVERYDAY ? dict.EVERYDAY : dict.KNOWN)
    || (g.deep ? dict.exampleWord(frag, dict.KNOWN) : null);
}
