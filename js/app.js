// The page: choosing who's at the table, then the game itself. The rules are in rules.js, the ghosts in ghosts.js.
import * as dict from './dict.js';
import * as R from './rules.js';
import { GHOSTS, ghostById, chooseMove, nameWord } from './ghosts.js';
import { Board } from './board.js';
import { ghostSvg, candleSvg } from './art.js';

const $ = id => document.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms));
const quick = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const pause = ms => wait(quick() ? Math.min(ms, 120) : ms);
const esc = t => String(t).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const MAX_SEATS = 6;

// Saved in the browser: who's at the table, the game in progress, and your record against each ghost.
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(`ghost.${key}`); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { value == null ? localStorage.removeItem(`ghost.${key}`) : localStorage.setItem(`ghost.${key}`, JSON.stringify(value)); } catch {}
  },
};

// What comes out of storage is checked on the way in. Only a hand edit or a damaged save fails these checks, and
// then the page starts from the defaults instead of stopping. A save the game wrote comes through as it is.
function cleanTable(t) {
  const ok = !!t && typeof t === 'object';
  const people = ok && Array.isArray(t.people) && t.people.length && t.people.every(p => typeof p === 'string') ? t.people : ['You'];
  const ghosts = ok && Array.isArray(t.ghosts) ? t.ghosts.filter((id, i) => ghostById(id) && t.ghosts.indexOf(id) === i) : ['wisp'];
  return { people, ghosts };
}

function cleanRecord(r) {
  const out = {};
  for (const { id } of GHOSTS) {
    const v = r && typeof r === 'object' ? r[id] : null;
    if (v && Number.isInteger(v.won) && v.won >= 0 && Number.isInteger(v.lost) && v.lost >= 0) out[id] = v;
  }
  return out;
}

// A saved game to pick up again: the shape the rules make, ghosts this page knows, and not a finished game already counted.
const resumable = g => R.isGame(g) && g.players.every(p => p.kind === 'person' || ghostById(p.ghost)) && !(g.phase === 'done' && g.recorded);

let table = cleanTable(store.get('table', null));
let record = cleanRecord(store.get('record', null));
let s = null;   // the game in progress (see rules.js)
let gen = 0;    // bumps whenever the game moves on, so a ghost that was mid-thought knows to stop
let preview = null;
let shown = ''; // the letters on the table when the word was last drawn

dict.loadMore(); // the rarer words, for challenges; the everyday ones are already here

// ---------- Words for people ----------

const isYou = p => p.kind === 'person' && p.name === 'You';
const nameOf = i => s.players[i].name;
const verb = (i, you, they) => (isYou(s.players[i]) ? you : they);
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const an = L => (/[AEFHILMNORSX]/.test(L) ? `an ${L}` : `a ${L}`);
const big = t => t.toUpperCase();

// ---------- Setup ----------

function renderSetup() {
  $('mastGhosts').innerHTML = GHOSTS.map(g => `<span class="float g-${g.id}">${ghostSvg(g.id)}</span>`).join('');
  const seats = table.people.length + table.ghosts.length;
  const people = $('people');
  people.replaceChildren(...table.people.map((name, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="avatar">${candleSvg(0)}</span>
      <label class="visually-hidden" for="p${i}">Name of person ${i + 1}</label>
      <input id="p${i}" value="${esc(name)}" maxlength="14" autocomplete="off" spellcheck="false" placeholder="Name">
      <button type="button" class="remove" aria-label="Remove ${esc(name || `person ${i + 1}`)}" ${table.people.length === 1 ? 'disabled' : ''}>×</button>`;
    li.querySelector('input').addEventListener('input', e => { table.people[i] = e.target.value; store.set('table', table); });
    li.querySelector('.remove').addEventListener('click', () => {
      table.people.splice(i, 1);
      store.set('table', table);
      renderSetup();
    });
    return li;
  }));
  $('addPerson').disabled = seats >= MAX_SEATS;

  $('ghostPicks').replaceChildren(...GHOSTS.map(g => {
    const on = table.ghosts.includes(g.id);
    const rec = record[g.id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ghost-pick g-${g.id}`;
    b.setAttribute('aria-pressed', on);
    b.disabled = !on && seats >= MAX_SEATS;
    b.innerHTML = `<span class="avatar">${ghostSvg(g.id)}</span>
      <span class="pick-text"><span class="pick-name">${g.name} <em>${g.level}</em></span>
      <span class="pick-about">${g.about}</span>
      ${rec ? `<span class="pick-record">Your games with ${g.name}: ${rec.won} won, ${rec.lost} lost</span>` : ''}</span>
      <span class="check" aria-hidden="true"></span>`;
    b.addEventListener('click', () => {
      table.ghosts = on ? table.ghosts.filter(x => x !== g.id) : GHOSTS.map(x => x.id).filter(x => x === g.id || table.ghosts.includes(x));
      store.set('table', table);
      renderSetup();
    });
    return b;
  }));

  const ok = seats >= 2;
  $('start').disabled = !ok;
  $('tableNote').textContent = ok ? '' : 'Pick a ghost, or add another person, so there’s someone to play against.';
}

$('addPerson').addEventListener('click', () => {
  table.people.push('');
  store.set('table', table);
  renderSetup();
  $(`p${table.people.length - 1}`)?.focus();
});

$('start').addEventListener('click', () => startGame());
$('rulesLink').addEventListener('click', () => $('rules').showModal());

// `again`: another game at the same table, from Play again or the menu.
function startGame(again = false) {
  // "You" only makes sense when there's one of you.
  const solo = table.people.length === 1;
  const people = table.people.map((name, i) => {
    const n = name.trim();
    return { kind: 'person', name: solo ? n || 'You' : n && n !== 'You' ? n : `Player ${i + 1}` };
  });
  const ghosts = table.ghosts.map(id => ({ kind: 'ghost', ghost: id, name: ghostById(id).name }));
  if (people.length + ghosts.length < 2) return;
  // The people sit first. Between good players whoever opens a game has a big edge, so in pass and play each game at the
  // same table starts with the next person. Alone with the ghosts, you always start.
  const opener = again && s ? ((s.opener ?? 0) + 1) % people.length : 0;
  hideResult();
  setState(R.newGame([...people, ...ghosts], opener));
  show('game');
  board.goHome(); // nothing lit from the last game, and the planchette resting in the middle
}

function show(which) {
  $('setup').hidden = which !== 'setup';
  $('game').hidden = which !== 'game';
  if (which === 'setup') { gen++; renderSetup(); window.scrollTo(0, 0); }
  if (which === 'game') board.layout();
}

// ---------- Game ----------

const board = new Board($('board'), {
  // Grow the board into whatever height the phone has left, keeping room for the word and the status line.
  room: () => innerHeight - $('players').getBoundingClientRect().bottom - 190,
  onPreview: c => { preview = c; renderWord(); },
  onPick: c => pick(c),
  onCorner: c => {
    if (c === 'no' && R.canChallenge(s) && personToAct() !== null) doChallenge();
    if (c === 'yes' && s.phase === 'naming' && personToAct() !== null) submitWord();
  },
});

// The person who should be using the board right now, or null if it's a ghost's move (or nobody's).
function personToAct() {
  if (!s) return null;
  const i = s.phase === 'play' ? s.turn : s.phase === 'naming' ? s.challenge.of : -1;
  return i >= 0 && s.players[i].kind === 'person' ? i : null;
}

function setState(next, { quiet = false } = {}) {
  s = next;
  store.set('game', s);
  render();
  if (!quiet) run();
}

// A person's letter or challenge. When it passes the board to another person, the board ignores taps for a moment, so a
// quick double tap doesn't also play a letter for them. Nobody passes a phone that fast.
function handOver(next) {
  const was = personToAct();
  setState(next);
  const now = personToAct();
  if (was !== null && now !== null && now !== was) board.settle(400);
}

function pick(c) {
  if (personToAct() === null) return;
  board.place(board.spots[c]);
  board.light(c);
  if (s.phase === 'play') handOver(R.addLetter(s, c, dict.endsRound));
  else if (s.phase === 'naming' && s.challenge.extra.length < 20) setState(R.setExtra(s, s.challenge.extra + c));
}

function doChallenge() {
  board.light('no');
  handOver(R.challenge(s));
}

async function submitWord() {
  const word = s.frag + s.challenge.extra;
  if (word.length < dict.MIN) return; // too short to count, whether it came from the plaque, YES or Enter
  await dict.loadMore();
  setState(R.nameWord(s, word, dict.isWord(word)));
}

async function run() {
  const my = ++gen;
  if (!s) return;
  if (s.phase === 'over' || s.phase === 'done') {
    board.setEnabled(false);
    await pause(700);
    if (my === gen) showResult();
    return;
  }
  const actor = s.phase === 'play' ? s.turn : s.challenge.of;
  const p = s.players[actor];
  if (p.kind === 'person') { board.setEnabled(true); return; }
  board.setEnabled(false);
  const g = ghostById(p.ghost);
  if (g.deep) await dict.loadMore();

  if (s.phase === 'play') {
    await pause(250);
    if (my !== gen) return;
    await board.wander(500 + Math.random() * 600);
    if (my !== gen) return;
    const move = chooseMove(g, s);
    if (move.challenge) {
      await board.glideTo('no');
      if (my !== gen) return;
      setState(R.challenge(s));
      return;
    }
    await board.glideTo(move.letter);
    if (my !== gen) return;
    const note = move.bluff ? { bluff: true } : move.rare ? { rare: true } : {};
    setState(R.addLetter(s, move.letter, dict.endsRound, note));
    return;
  }

  // Challenged: name a word, spelled out on the board, or own up.
  await pause(500);
  if (my !== gen) return;
  await board.wander(700);
  if (my !== gen) return;
  const word = nameWord(g, s.frag, s.moves.at(-1));
  if (!word) {
    setStatus(`${g.name} can’t think of one.`);
    await pause(1100);
    if (my === gen) setState(R.giveUp(s));
    return;
  }
  await board.glideTo('yes', 700);
  if (my !== gen) return;
  if (s.challenge.extra) setState(R.setExtra(s, ''), { quiet: true }); // picked up again after a reload
  for (const c of word.slice(s.frag.length)) {
    if (my !== gen) return;
    await board.glideTo(c, 560);
    if (my !== gen) return;
    setState(R.setExtra(s, s.challenge.extra + c), { quiet: true });
  }
  await pause(400);
  if (my === gen) setState(R.nameWord(s, word, true));
}

// ---------- Drawing the game ----------

function render() {
  if (!s) return;
  board.layout();
  $('roundNo').textContent = `Round ${s.round}`;
  renderPlayers();
  renderWord();
  renderStatus();
  renderPlaques();
}

function renderPlayers() {
  const acting = s.phase === 'play' ? s.turn : s.phase === 'naming' ? s.challenge.of : -1;
  $('players').classList.toggle('many', s.players.length >= 3);
  $('players').classList.toggle('four', s.players.length === 4);
  $('players').classList.toggle('six', s.players.length === 6);
  $('players').replaceChildren(...s.players.map((p, i) => {
    const li = document.createElement('li');
    const out = p.letters >= R.GHOST.length;
    li.className = `player ${p.kind}${i === acting ? ' acting' : ''}${out ? ' out' : ''}${p.ghost ? ` g-${p.ghost}` : ''}`;
    li.style.setProperty('--fade', p.kind === 'ghost' ? String(1 - p.letters * 0.15) : '1');
    const art = p.kind === 'ghost' ? ghostSvg(p.ghost) : out ? ghostSvg('wisp', 'mine') : candleSvg(p.letters, true);
    const has = p.letters ? `${isYou(p) ? 'have' : 'has'} ${[...R.GHOST.slice(0, p.letters)].join(' ')}` : 'no letters yet';
    li.innerHTML = `<span class="avatar">${art}</span>
      <span class="pname">${esc(p.name)}</span>
      <span class="letters" aria-hidden="true">${[...R.GHOST].map((L, k) => `<b class="${k < p.letters ? 'got' : ''}">${L}</b>`).join('')}</span>
      <span class="visually-hidden">${has}</span>`;
    return li;
  }));
}

function renderWord() {
  if (!s) return;
  const el = $('word');
  const naming = s.phase === 'naming';
  const extra = naming ? s.challenge.extra : '';
  const person = personToAct() !== null;
  const pend = person && preview && !(naming && extra.length >= 20) ? preview : '';
  // Only letters that weren't showing last time fade in, so the word holds still while you choose the next one,
  // when you erase one, and when the letters after a challenge leave the table.
  const word = s.frag + extra;
  let from = 0;
  while (from < word.length && word[from] === shown[from]) from++;
  shown = word;
  const parts = [...word].map((c, k) => {
    const cls = [k >= s.frag.length ? 'extra' : '', k >= from ? 'new' : ''].join(' ').trim();
    return `<span class="${cls}">${big(c)}</span>`;
  });
  if (pend) parts.push(`<span class="pending">${big(pend)}</span>`);
  else if (person && (s.phase === 'play' || naming)) parts.push('<span class="cursor" aria-hidden="true"></span>');
  const n = s.frag.length + extra.length + 1;
  const width = el.parentElement.clientWidth || 360;
  el.style.fontSize = `${Math.min(64, Math.max(22, (width * 0.94) / (n * 0.86 + 0.4)))}px`;
  el.innerHTML = parts.join('') || '';
  el.classList.toggle('empty', !s.frag && !extra && !pend);
  el.setAttribute('aria-label', s.frag || extra ? `The word so far: ${big(s.frag + extra).split('').join(' ')}` : 'No letters yet');
}

function setStatus(text) { $('status').innerHTML = text; }

function renderStatus() {
  const i = personToAct();
  if (s.phase === 'play') {
    const who = nameOf(s.turn);
    const canCh = R.canChallenge(s);
    if (i === null) return setStatus(`<em>${esc(who)} is choosing…</em>`);
    const lastMove = s.moves.at(-1);
    const added = lastMove && s.players[lastMove.by].kind === 'ghost' ? `${esc(nameOf(lastMove.by))} added ${big(lastMove.letter)}. ` : '';
    const lead = added + (isYou(s.players[i]) ? 'Your turn.' : `${esc(who)}’s turn.`);
    if (!s.frag) return setStatus(`${lead} Pick any letter to start.`);
    return setStatus(`${lead} Add a letter${canCh ? `, or challenge ${esc(nameOf(s.last))} if you don’t think any word starts with ${big(s.frag)}` : ''}.`);
  }
  if (s.phase === 'naming') {
    const { by, of, wrong, tries } = s.challenge;
    const frag = big(s.frag);
    if (s.players[of].kind === 'ghost') return setStatus(`<em>${esc(nameOf(by))} ${verb(by, 'challenge', 'challenges')} ${esc(nameOf(of))} to name a word that starts with ${frag}…</em>`);
    if (tries && wrong && wrong === s.frag + s.challenge.extra) {
      return setStatus(`${big(wrong)} isn’t in the word list. Change it, give up, or count it anyway if you’re sure.`);
    }
    const challenger = s.players[by].kind === 'ghost' || !isYou(s.players[by]) ? nameOf(by) : 'You';
    const who = isYou(s.players[of]) ? 'you' : esc(nameOf(of));
    return setStatus(`${esc(challenger)} ${challenger === 'You' ? 'challenge' : 'challenges'} ${who}. ${isYou(s.players[of]) ? 'Finish' : `${esc(nameOf(of))}, finish`} a word that starts with ${frag}, then tap Yes.`);
  }
  setStatus('');
}

function renderPlaques() {
  const i = personToAct();
  if (s.phase === 'naming' && i !== null) {
    const { extra, wrong, tries } = s.challenge;
    const word = s.frag + extra;
    const list = [
      { label: 'Erase', onClick: () => extra && setState(R.setExtra(s, extra.slice(0, -1))), disabled: !extra, id: 'erase' },
      { label: 'Give up', onClick: () => setState(R.giveUp(s)), id: 'giveUp' },
    ];
    if (tries && wrong === word) list.push({ label: 'Count it', onClick: () => setState(R.nameWord(s, word, true)), kind: 'strong', id: 'countIt' });
    else list.push({ label: 'Yes, that’s it', onClick: submitWord, disabled: word.length < dict.MIN, kind: 'strong', id: 'done' });
    board.setPlaques(list);
    return;
  }
  if (s.phase === 'play') {
    const label = R.canChallenge(s) ? `Challenge ${s.players[s.last].name}` : 'Challenge';
    board.setPlaques([{ label, onClick: doChallenge, disabled: i === null || !R.canChallenge(s), id: 'challenge' }]);
    if (i === null) board.el.querySelector('.plaque').classList.add('asleep');
    return;
  }
  board.setPlaques([]);
}

// ---------- End of a round ----------

function showResult() {
  const r = s.result;
  const loser = s.players[r.loser];
  let kicker, word, why, also = '';
  if (r.why === 'spelled') {
    kicker = 'That’s a word';
    word = big(r.word);
    why = `${esc(isYou(loser) ? 'You' : loser.name)} finished it.`;
    const alt = otherWay(r.word);
    if (alt) also = `${big(r.word.slice(0, -1))} could have gone on to ${big(alt)}.`;
  } else if (r.why === 'named') {
    const by = s.players[r.by];
    const of = s.players[s.challenge.of];
    kicker = 'The challenge fails';
    word = big(r.word);
    why = `${esc(isYou(of) ? 'You' : of.name)} named a word that starts with ${big(r.frag)}, so ${isYou(by) ? 'your' : `${esc(by.name)}’s`} challenge fails.`;
  } else {
    const of = s.players[s.challenge.of];
    kicker = 'Caught bluffing';
    word = `${big(r.frag)}…`;
    why = `${esc(isYou(of) ? 'You' : of.name)} couldn’t name a word that starts with ${big(r.frag)}.`;
    const real = dict.exampleWord(r.frag);
    // Without the big list (it didn't download) a rarer word might still have done it, so only say there's none with it here.
    also = real ? `${big(real)} would have done it.` : dict.moreReady() && !dict.anyWordStarts(r.frag) ? 'There isn’t one.' : '';
  }
  $('resultKicker').textContent = kicker;
  $('resultWord').textContent = word;
  $('resultWhy').innerHTML = why;
  $('resultAlso').textContent = also;
  $('resultAlso').hidden = !also;

  const L = R.GHOST[loser.letters - 1];
  const name = esc(isYou(loser) ? 'You' : loser.name);
  const out = loser.letters >= R.GHOST.length;
  const line = out
    ? loser.kind === 'ghost' ? `That’s GHOST. ${name} fades away.` : `That’s GHOST. ${name} ${isYou(loser) ? 'are' : 'is'} out, and ${isYou(loser) ? 'you’re' : 'now'} a ghost${isYou(loser) ? ' now' : ''}.`
    : `${name} ${isYou(loser) ? 'take' : 'takes'} ${an(L)}.`;
  $('resultLoser').innerHTML = `<div class="loser-art">${loser.kind === 'ghost' ? ghostSvg(loser.ghost) : out ? ghostSvg('wisp', 'mine') : candleSvg(loser.letters)}</div>
    <div class="loser-letters">${[...R.GHOST].map((c, k) => `<b class="${k < loser.letters - 1 ? 'got' : k === loser.letters - 1 ? 'got new' : ''}">${c}</b>`).join('')}</div>
    <p>${line}</p>`;

  const actions = $('resultActions');
  if (s.phase === 'done') {
    const w = s.winner >= 0 ? s.players[s.winner] : null;
    const verdict = !w ? 'The ghosts win.' : isYou(w) ? 'You win the game.' : `${esc(w.name)} wins the game.`;
    actions.innerHTML = `<p class="verdict">${verdict}</p>
      <button type="button" class="primary" id="again">Play again</button>
      <button type="button" class="linkish" id="change">Change who’s playing</button>`;
    $('again').addEventListener('click', () => startGame(true));
    $('change').addEventListener('click', () => { hideResult(); store.set('game', null); s = null; show('setup'); });
    saveRecord();
  } else {
    actions.innerHTML = '<button type="button" class="primary" id="nextRound">Next round</button>';
    $('nextRound').addEventListener('click', () => { hideResult(); board.goHome(); setState(R.nextRound(s)); });
  }
  $('result').hidden = false;
  fitOnOneLine($('resultWord'), 56, 16);
  requestAnimationFrame(() => $('result').classList.add('shown'));
  actions.querySelector('.primary')?.focus({ preventScroll: true });
}

// Another everyday word the last player could have been heading for instead of spelling this one.
function otherWay(word) {
  const before = word.slice(0, -1);
  const node = dict.nodeAt(before);
  let best = null;
  for (const c in node?.k || {}) {
    const kid = node.k[c];
    if (c === word.at(-1) || kid.e || !(kid.r & dict.EVERYDAY)) continue;
    const w = dict.exampleWord(before + c, dict.EVERYDAY);
    if (w && (!best || w.length < best.length)) best = w;
  }
  return best;
}

// Text as big as fits on one line of its box, up to `max` px, so a long word doesn't break in the middle.
// Past `min` px it wraps instead.
function fitOnOneLine(el, max, min) {
  el.style.fontSize = `${max}px`;
  el.style.whiteSpace = 'nowrap';
  const text = document.createRange();
  text.selectNodeContents(el);
  const fit = el.clientWidth / text.getBoundingClientRect().width;
  el.style.whiteSpace = '';
  if (fit < 1) el.style.fontSize = `${Math.max(min, Math.floor(max * fit * 0.98))}px`; // a little spare, as text doesn't scale exactly
}

function hideResult() {
  $('result').classList.remove('shown');
  $('result').hidden = true;
}

// Your record against each ghost, counted only when you're the one person playing.
function saveRecord() {
  if (s.recorded) return;
  const people = s.players.filter(p => p.kind === 'person');
  if (people.length === 1) {
    const won = s.winner >= 0 && s.players[s.winner].kind === 'person';
    for (const p of s.players) {
      if (p.kind !== 'ghost') continue;
      const r = record[p.ghost] || { won: 0, lost: 0 };
      r[won ? 'won' : 'lost']++;
      record[p.ghost] = r;
    }
    store.set('record', record);
  }
  s = { ...s, recorded: true };
  store.set('game', s);
}

// ---------- Menu, keys, start-up ----------

$('menuBtn').addEventListener('click', () => $('menu').showModal());
$('menuNew').addEventListener('click', () => { $('menu').close(); startGame(true); });
$('menuTable').addEventListener('click', () => { $('menu').close(); hideResult(); store.set('game', null); s = null; show('setup'); });
$('menuRules').addEventListener('click', () => { $('menu').close(); $('rules').showModal(); });
for (const d of [$('menu'), $('rules')]) d.addEventListener('click', e => { if (e.target === d) d.close(); });

document.addEventListener('keydown', e => {
  if (!s || $('game').hidden || !$('result').hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('dialog[open]') || e.target.matches?.('input') || board.settling()) return;
  const k = e.key.toLowerCase();
  if (/^[a-z]$/.test(k)) { pick(k); e.preventDefault(); }
  else if (k === 'backspace' && s.phase === 'naming' && personToAct() !== null && s.challenge.extra) setState(R.setExtra(s, s.challenge.extra.slice(0, -1)));
  // Enter names the word, unless a letter or plaque has the focus: then Enter is that button's (Erase, Give up, a letter).
  // On the Menu button, where the focus goes back whenever the menu closes, it names the word and leaves the menu shut.
  else if (k === 'enter' && s.phase === 'naming' && personToAct() !== null && !e.target.closest?.('.board button') && (s.frag + s.challenge.extra).length >= dict.MIN) {
    e.preventDefault();
    submitWord();
  }
});

addEventListener('resize', () => renderWord());

const saved = store.get('game', null);
if (resumable(saved)) {
  try {
    s = saved;
    show('game');
    render();
    run();
  } catch {
    s = null;
    show('setup');
  }
} else {
  show('setup');
}

if ('serviceWorker' in navigator && !('single' in document.documentElement.dataset)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// For the tests and the screenshot script.
window.ghostGame = { dict, rules: R, state: () => s, set: (next) => { hideResult(); setState(next); show('game'); } };
