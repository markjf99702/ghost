// The dictionary. Two parts:
// - A tree of the words that end a round (js/words-ends.js). Only words you can actually reach are in it:
//   "players" isn't, because the round ends at "play". Every node knows which kinds of word lie below it.
// - Every other word that counts when you're challenged (js/words-more.js), loaded after the page is up.
import ENDS from './words-ends.js';
import { decode } from './packed.js';

export const MIN = 4; // shortest word that ends a round

// Kinds of word, as bits on each node: what lies somewhere below it.
export const EVERYDAY = 1; // common words (SCOWL size 35)
export const KNOWN = 2;    // common and less common words
export const ANY = 4;      // any round-ending word, including ones the ghosts never aim for

const make = () => ({ k: {}, e: 0, r: 0, n1: 0, n2: 0 });
export const root = make();
for (const line of decode(ENDS)) {
  const mark = line.at(-1);
  const tier = mark === '+' ? 2 : mark === '!' ? 3 : 1;
  const word = tier === 1 ? line : line.slice(0, -1);
  const bits = tier === 1 ? EVERYDAY | KNOWN | ANY : tier === 2 ? KNOWN | ANY : ANY;
  let node = root;
  node.r |= bits;
  if (tier === 1) node.n1++;
  if (tier <= 2) node.n2++;
  for (const c of word) {
    node = node.k[c] ||= make();
    node.r |= bits;
    if (tier === 1) node.n1++;
    if (tier <= 2) node.n2++;
  }
  node.e = tier; // 1 everyday, 2 less common, 3 a word the ghosts never aim for
}

export function nodeAt(frag) {
  let node = root;
  for (const c of frag) if (!(node = node.k[c])) return null;
  return node;
}

/** 0 if these letters don't end the round, otherwise how common the word is (1 everyday, 2 less common, 3 rude). */
export const endsRound = frag => (frag.length >= MIN && nodeAt(frag)?.e) || 0;

// The rest of the words, sorted.
let more = null;
const unsaid = new Set(); // words that count when a person names one, but a ghost never says
let loading = null;
export const loadMore = () => (loading ||= import('./words-more.js').then(m => {
  more = decode(m.default).map(line => {
    if (!line.endsWith('!')) return line;
    const w = line.slice(0, -1);
    unsaid.add(w);
    return w;
  });
  return true;
}));
export const moreReady = () => more !== null;

function lowerBound(s) {
  let lo = 0, hi = more.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (more[mid] < s) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Words from the big list that start with these letters (not including round-ending words). */
export function moreStarting(frag, limit = Infinity, { forGhost = false } = {}) {
  if (!more) return [];
  const out = [];
  for (let i = lowerBound(frag); i < more.length && out.length < limit && more[i].startsWith(frag); i++) {
    if (!(forGhost && unsaid.has(more[i]))) out.push(more[i]);
  }
  return out;
}

/** Is this a word, for naming one after a challenge? Needs loadMore() to have finished for the rarer ones. */
export function isWord(w) {
  if (w.length < MIN || !/^[a-z]+$/.test(w)) return false;
  if (endsRound(w)) return true;
  if (!more) return false;
  const i = lowerBound(w);
  return more[i] === w;
}

/** Does any word at all start with these letters? */
export const anyWordStarts = frag => !!(nodeAt(frag)?.r & ANY) || moreStarting(frag, 1).length > 0;

/** A short, common word that starts with these letters, for showing what it could have been. */
export function exampleWord(frag, bits = KNOWN) {
  const start = nodeAt(frag);
  if (start && start.r & bits) {
    // Breadth first, so the shortest comes out first; everyday words before less common ones.
    for (const want of bits === EVERYDAY ? [EVERYDAY] : [EVERYDAY, KNOWN]) {
      if (!(start.r & want)) continue;
      let level = [[start, frag]];
      while (level.length) {
        const next = [];
        for (const [node, word] of level) {
          if (node.e && node.e !== 3 && (want === KNOWN || node.e === 1)) return word;
          for (const c in node.k) if (node.k[c].r & want) next.push([node.k[c], word + c]);
        }
        level = next;
      }
    }
  }
  if (bits === EVERYDAY) return null;
  const rare = moreStarting(frag, 400, { forGhost: true });
  return rare.length ? rare.reduce((a, b) => (b.length < a.length ? b : a)) : null;
}
