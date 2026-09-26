// The spirit board: the alphabet in arcs, YES and NO in the top corners, a row of plaques along the bottom
// for challenging and naming words, and the planchette.
//
// Press anywhere on the board and the nearest letter lights up and the planchette slides to it; slide your
// finger to change your mind, and let go to play it. Letters are also buttons, so the keyboard works too.
import { PLANCHETTE, WINDOW, SUN, MOON } from './art.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = ms => new Promise(r => setTimeout(r, ms));

export class Board {
  constructor(el, { onPreview, onPick, onCorner, room }) {
    this.el = el;
    this.room = room; // how tall the board may grow
    this.onPreview = onPreview;
    this.onPick = onPick;
    this.onCorner = onCorner;
    this.enabled = false;
    this.letters = {};
    this.spots = {};
    this.pos = null;
    this.pointerAt = -Infinity;

    el.innerHTML = `
      <div class="frame" aria-hidden="true"></div>
      <div class="corner yes" data-corner="yes"><span class="sun">${SUN}</span><b>Yes</b></div>
      <div class="corner no" data-corner="no"><b>No</b><span class="moon">${MOON}</span></div>
      <div class="alphabet" role="group" aria-label="Letters"></div>
      <div class="plaques"></div>
      <div class="planchette" aria-hidden="true">${PLANCHETTE}</div>`;
    this.alphabet = el.querySelector('.alphabet');
    this.plaques = el.querySelector('.plaques');
    this.planchette = el.querySelector('.planchette');
    for (const c of 'abcdefghijklmnopqrstuvwxyz') {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'letter';
      b.textContent = c.toUpperCase();
      b.dataset.letter = c;
      b.setAttribute('aria-label', c.toUpperCase());
      // Keyboard and screen readers click; pointers are handled on the board, so skip the click a tap makes.
      b.addEventListener('click', e => {
        if (e.pointerType || performance.now() - this.pointerAt < 800) return;
        if (this.enabled) this.onPick(c);
      });
      this.alphabet.append(b);
      this.letters[c] = b;
    }

    el.addEventListener('pointerdown', e => this.down(e));
    el.addEventListener('pointermove', e => this.move(e));
    el.addEventListener('pointerup', e => this.up(e));
    el.addEventListener('pointercancel', () => this.cancel());
    el.addEventListener('lostpointercapture', () => this.cancel());
    new ResizeObserver(() => this.layout()).observe(el.parentElement);
    addEventListener('resize', () => this.layout());
    this.layout();
  }

  layout() {
    const W = Math.round(this.el.parentElement.clientWidth);
    const room = Math.round(this.room?.() ?? Infinity);
    if (!W || (W === this.width && room === this.roomWas)) return;
    this.width = W;
    this.roomWas = room;
    const rows = W >= 520 ? ['abcdefghijklm', 'nopqrstuvwxyz'] : ['abcdefghi', 'jklmnopqr', 'stuvwxyz'];
    const most = Math.max(...rows.map(r => r.length));
    const s = Math.min(46, (W * 0.8) / (most - 1)); // space between letters, along the arc
    const R = W * 0.9;
    const topY = Math.max(64, W * 0.13);
    // The rows are the same arc, one below the other, like the lines on a real board.
    const sag = R * (1 - Math.cos(((most - 1) / 2) * (s / R)));
    const fixed = topY + sag + s * 0.6 + 76;
    const gap = Math.max(s * 1.25, Math.min(s * 1.8, (room - fixed) / (rows.length - 1)));
    let bottom = 0;
    rows.forEach((row, r) => {
      const cy = topY + R + r * gap;
      [...row].forEach((c, i) => {
        const a = (i - (row.length - 1) / 2) * (s / R);
        const x = W / 2 + R * Math.sin(a);
        const y = cy - R * Math.cos(a);
        this.spots[c] = { x, y };
        const b = this.letters[c];
        b.style.left = `${x}px`;
        b.style.top = `${y}px`;
        b.style.transform = `translate(-50%, -50%) rotate(${a}rad)`;
        bottom = Math.max(bottom, y);
      });
    });
    this.spacing = s;
    this.gap = gap;
    this.el.style.setProperty('--letter', `${Math.round(s * 0.84)}px`);
    this.el.style.setProperty('--plan', `${Math.round(s * 2)}px`);
    const H = Math.round(bottom + s * 0.6 + 76);
    this.el.style.height = `${H}px`;
    this.height = H;
    const corner = name => {
      const box = this.el.querySelector(`.corner.${name}`);
      return { x: box.offsetLeft + box.offsetWidth / 2, y: box.offsetTop + box.offsetHeight / 2 };
    };
    this.spots.yes = corner('yes');
    this.spots.no = corner('no');
    const home = !this.pos || (this.rest && this.pos.x === this.rest.x && this.pos.y === this.rest.y);
    this.rest = { x: W / 2, y: bottom + s * 0.2 };
    if (home) { this.place(this.rest, false); this.planchette.classList.add('resting'); }
    else this.place(this.pos, false);
  }

  // Put the planchette's window over a point on the board.
  place({ x, y }, smooth = true) {
    this.pos = { x, y };
    if (this.rest && (x !== this.rest.x || y !== this.rest.y)) this.planchette.classList.remove('resting');
    const p = this.planchette;
    const w = p.offsetWidth, h = p.offsetHeight;
    p.style.transition = smooth && !reduceMotion() ? 'transform .18s ease-out' : 'none';
    p.style.transform = `translate(${x - w * WINDOW.x}px, ${y - h * WINDOW.y}px)`;
  }

  // Drift to a letter (or 'yes' / 'no') the way a ghost would: not quite in a straight line.
  async glideTo(target, ms = 850) {
    const to = this.spots[target];
    if (!to) return;
    const from = this.pos || this.rest;
    const p = this.planchette;
    const w = p.offsetWidth, h = p.offsetHeight;
    const at = ({ x, y }) => `translate(${x - w * WINDOW.x}px, ${y - h * WINDOW.y}px)`;
    const dx = to.x - from.x, dy = to.y - from.y;
    const bend = (Math.random() - 0.5) * 0.7;
    const mid = { x: from.x + dx / 2 - dy * bend, y: from.y + dy / 2 + dx * bend };
    p.style.transition = 'none';
    p.classList.remove('resting');
    if (!reduceMotion()) {
      await p.animate([{ transform: at(from) }, { transform: at(mid) }, { transform: at(to) }], { duration: ms, easing: 'ease-in-out' }).finished;
    }
    this.place(to, false);
    this.light(target);
    await wait(reduceMotion() ? 150 : 320);
  }

  // Wander a little, as if thinking.
  async wander(ms = 700) {
    if (reduceMotion()) return wait(ms / 2);
    const from = this.pos || this.rest;
    const r = this.spacing * 1.2;
    const to = {
      x: Math.min(this.width - 40, Math.max(40, from.x + (Math.random() - 0.5) * r * 2)),
      y: Math.min(this.height - 90, Math.max(60, from.y + (Math.random() - 0.5) * r)),
    };
    const p = this.planchette;
    const w = p.offsetWidth, h = p.offsetHeight;
    const at = ({ x, y }) => `translate(${x - w * WINDOW.x}px, ${y - h * WINDOW.y}px)`;
    p.style.transition = 'none';
    await p.animate([{ transform: at(from) }, { transform: at(to) }], { duration: ms, easing: 'ease-in-out' }).finished;
    this.place(to, false);
  }

  light(target) {
    this.el.querySelectorAll('.lit').forEach(x => x.classList.remove('lit'));
    const node = this.letters[target] || this.el.querySelector(`.corner.${target}`);
    node?.classList.add('lit');
  }

  // Back to the middle of the board between rounds, faded until someone picks it up.
  goHome() {
    this.light(null);
    this.place(this.rest);
    this.planchette.classList.add('resting');
  }

  setEnabled(on) {
    this.enabled = on;
    this.el.classList.toggle('live', on);
    for (const b of Object.values(this.letters)) b.tabIndex = on ? 0 : -1;
    if (!on) this.cancel();
  }

  /** Buttons along the bottom of the board: [{ label, onClick, disabled, kind }] */
  setPlaques(list) {
    this.plaques.replaceChildren(...list.map(({ label, onClick, disabled, kind, id }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `plaque ${kind || ''}`;
      b.textContent = label;
      if (id) b.id = id;
      b.disabled = !!disabled;
      b.addEventListener('click', onClick);
      return b;
    }));
  }

  nearest(e) {
    const box = this.el.getBoundingClientRect();
    const x = e.clientX - box.left, y = e.clientY - box.top;
    let best = null, bestD = Infinity;
    for (const [c, p] of Object.entries(this.spots)) {
      if (c.length !== 1) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return bestD < Math.max(this.spacing, this.gap * 0.8) * 1.1 ? best : null;
  }

  corner(e) {
    return e.target.closest?.('[data-corner]')?.dataset.corner || null;
  }

  down(e) {
    if (!this.enabled || e.button > 0 || e.target.closest('.plaque')) return;
    const corner = this.corner(e);
    if (corner) { this.pressedCorner = corner; return; }
    e.preventDefault();
    this.el.setPointerCapture?.(e.pointerId);
    this.pressing = true;
    this.hover(this.nearest(e));
  }

  move(e) {
    if (this.pressing) this.hover(this.nearest(e));
  }

  up(e) {
    this.pointerAt = performance.now();
    if (this.pressedCorner) {
      const c = this.corner(e) === this.pressedCorner ? this.pressedCorner : null;
      this.pressedCorner = null;
      if (c && this.enabled) this.onCorner(c);
      return;
    }
    if (!this.pressing) return;
    const c = this.nearest(e) || this.current;
    this.pressing = false;
    this.current = null;
    this.onPreview(null);
    if (c && this.enabled) this.onPick(c);
  }

  cancel() {
    if (!this.pressing) return;
    this.pressing = false;
    this.current = null;
    this.onPreview(null);
    this.light(null);
  }

  hover(c) {
    if (c === this.current) return;
    this.current = c;
    this.light(c);
    if (c) this.place(this.spots[c]);
    this.onPreview(c);
  }
}
