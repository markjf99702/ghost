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

let table = store.get('table', { people: ['You'], ghosts: ['wisp'] });
let record = store.get('record', {});
let s = null;   // the game in progress (see rules.js)
let gen = 0;    // bumps whenever the game moves on, so a ghost that was mid-thought knows to stop
let preview = null;

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

function startGame() {
  // "You" only makes sense when there's one of you.
  const solo = table.people.length === 1;
  const people = table.people.map((name, i) => {
    const n = name.trim();
    return { kind: 'person', name: solo ? n || 'You' : n && n !== 'You' ? n : `Player ${i + 1}` };
  });
  const ghosts = table.ghosts.map(id => ({ kind: 'ghost', ghost: id, name: ghostById(id).name }));
  if (people.length + ghosts.length < 2) return;
  hideResult();
  setState(R.newGame([...people, ...ghosts]));
  show('game');
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
    if (c === 'no' && R.canChallenge(s) && personToAct()) doChallenge();
    if (c === 'yes' && s.phase === 'naming' && personToAct()) submitWord();
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

function pick(c) {
  if (personToAct() === null) return;
  board.place(board.spots[c]);
  board.light(c);
  if (s.phase === 'play') setState(R.addLetter(s, c, dict.endsRound));
  else if (s.phase === 'naming' && s.challenge.extra.length < 20) setState(R.setExtra(s, s.challenge.extra + c));
}

function doChallenge() {
  board.light('no');
  setState(R.challenge(s));
}

async function submitWord() {
  const word = s.frag + s.challenge.extra;
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
  $('players').classList.toggle('many', s.players.length >= 4);
  $('players').classList.toggle('four', s.players.length === 4);
  $('players').replaceChildren(...s.players.map((p, i) => {
    const li = document.createElement('li');
    const out = p.letters >= R.GHOST.length;
    li.className = `player ${p.kind}${i === acting ? ' acting' : ''}${out ? ' out' : ''}${p.ghost ? ` g-${p.ghost}` : ''}`;
    li.style.setProperty('--fade', p.kind === 'ghost' ? String(1 - p.letters * 0.15) : '1');
    const art = p.kind === 'ghost' ? ghostSvg(p.ghost) : out ? ghostSvg('wisp', 'mine') : candleSvg(p.letters, true);
    li.innerHTML = `<span class="avatar">${art}</span>
      <span class="pname">${esc(p.name)}</span>
      <span class="letters" aria-label="${p.letters ? `has ${R.GHOST.slice(0, p.letters)}` : 'no letters yet'}">${[...R.GHOST].map((L, k) => `<b class="${k < p.letters ? 'got' : ''}">${L}</b>`).join('')}</span>`;
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
  const parts = [...s.frag].map(c => `<span>${big(c)}</span>`)
    .concat([...extra].map(c => `<span class="extra">${big(c)}</span>`));
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
    also = real ? `${big(real)} would have done it.` : 'There isn’t one.';
  }
  $('resultKicker').textContent = kicker;
  $('resultWord').textContent = word;
  $('resultWord').style.fontSize = `${Math.min(56, Math.max(26, 300 / (word.length * 0.7)))}px`;
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
    $('again').addEventListener('click', () => startGame());
    $('change').addEventListener('click', () => { hideResult(); store.set('game', null); s = null; show('setup'); });
    saveRecord();
  } else {
    actions.innerHTML = '<button type="button" class="primary" id="nextRound">Next round</button>';
    $('nextRound').addEventListener('click', () => { hideResult(); board.goHome(); setState(R.nextRound(s)); });
  }
  $('result').hidden = false;
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
$('menuNew').addEventListener('click', () => { $('menu').close(); startGame(); });
$('menuTable').addEventListener('click', () => { $('menu').close(); hideResult(); store.set('game', null); s = null; show('setup'); });
$('menuRules').addEventListener('click', () => { $('menu').close(); $('rules').showModal(); });
for (const d of [$('menu'), $('rules')]) d.addEventListener('click', e => { if (e.target === d) d.close(); });

document.addEventListener('keydown', e => {
  if (!s || $('game').hidden || !$('result').hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('dialog[open]') || e.target.matches?.('input')) return;
  const k = e.key.toLowerCase();
  if (/^[a-z]$/.test(k)) { pick(k); e.preventDefault(); }
  else if (k === 'backspace' && s.phase === 'naming' && personToAct() !== null && s.challenge.extra) setState(R.setExtra(s, s.challenge.extra.slice(0, -1)));
  else if (k === 'enter' && s.phase === 'naming' && personToAct() !== null && (s.frag + s.challenge.extra).length >= dict.MIN) submitWord();
});

addEventListener('resize', () => renderWord());

const saved = store.get('game', null);
if (saved && saved.players && saved.phase && !(saved.phase === 'done' && saved.recorded)) {
  s = saved;
  show('game');
  render();
  run();
} else {
  show('setup');
}

if ('serviceWorker' in navigator && !('single' in document.documentElement.dataset)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// For the tests and the screenshot script.
window.ghostGame = { dict, rules: R, state: () => s, set: (next) => { hideResult(); setState(next); show('game'); } };
