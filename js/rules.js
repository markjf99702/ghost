// The rules of Ghost, as plain functions from one game state to the next. No page, no timers.
//
// Players take turns adding a letter to the end of the word so far. Spell a real word of four letters or more
// and you lose the round. Instead of adding a letter you can challenge the player before you: they have to
// name a word that starts with the letters so far. If they can, the challenger loses the round; if they can't,
// they do. Losing a round earns you the next letter of GHOST. Spell GHOST and you're out.
// The loser starts the next round. The last one left wins.

export const GHOST = 'GHOST';

export function newGame(players) {
  return {
    players: players.map(p => ({ ...p, letters: 0 })),
    round: 1,
    ...freshRound(0),
  };
}

function freshRound(starter) {
  return { frag: '', turn: starter, last: -1, phase: 'play', moves: [], challenge: null, result: null };
}

export const isIn = (s, i) => s.players[i].letters < GHOST.length;
export const playersIn = s => s.players.filter((p, i) => isIn(s, i)).length;

export function nextIn(s, i) {
  const n = s.players.length;
  for (let k = 1; k <= n; k++) if (isIn(s, (i + k) % n)) return (i + k) % n;
  return -1;
}

/** Whether the player to move may challenge instead of adding a letter. */
export const canChallenge = s => s.phase === 'play' && s.frag.length >= 2 && s.last >= 0 && s.last !== s.turn;

/** Add a letter. `endsRound(frag)` says whether the letters now spell a word that ends the round. */
export function addLetter(s, letter, endsRound, note = {}) {
  if (s.phase !== 'play') return s;
  const frag = s.frag + letter;
  const moves = [...s.moves, { by: s.turn, letter, ...note }];
  if (endsRound(frag)) return endRound({ ...s, frag, moves }, s.turn, { why: 'spelled', word: frag });
  return { ...s, frag, moves, last: s.turn, turn: nextIn(s, s.turn) };
}

/** The player to move says no word starts with these letters. The player before them has to name one. */
export function challenge(s) {
  if (!canChallenge(s)) return s;
  return { ...s, phase: 'naming', challenge: { by: s.turn, of: s.last, extra: '', tries: 0 } };
}

/** While naming a word: the letters after the ones already on the table. */
export function setExtra(s, extra) {
  if (s.phase !== 'naming') return s;
  return { ...s, challenge: { ...s.challenge, extra } };
}

/** The challenged player named a word. `ok` is whether it counts. */
export function nameWord(s, word, ok) {
  if (s.phase !== 'naming') return s;
  if (ok) return endRound(s, s.challenge.by, { why: 'named', word });
  return { ...s, challenge: { ...s.challenge, tries: s.challenge.tries + 1, wrong: word } };
}

/** The challenged player can't name a word. */
export function giveUp(s) {
  if (s.phase !== 'naming') return s;
  return endRound(s, s.challenge.of, { why: 'bluff' });
}

function endRound(s, loser, info) {
  const players = s.players.map((p, i) => (i === loser ? { ...p, letters: p.letters + 1 } : p));
  const next = { ...s, players, phase: 'over', result: { loser, frag: s.frag, ...info, by: s.challenge?.by ?? null } };
  const left = players.filter(p => p.letters < GHOST.length);
  const peopleLeft = left.filter(p => p.kind === 'person').length;
  if (left.length <= 1 || peopleLeft === 0) {
    next.phase = 'done';
    next.winner = left.length === 1 ? players.indexOf(left[0]) : -1; // -1: only ghosts are left
  }
  return next;
}

export function nextRound(s) {
  if (s.phase !== 'over') return s;
  const loser = s.result.loser;
  const starter = isIn(s, loser) ? loser : nextIn(s, loser);
  return { ...s, ...freshRound(starter), round: s.round + 1 };
}
