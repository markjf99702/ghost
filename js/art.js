// Little pictures, as SVG strings: the three ghosts, a candle for each person, the planchette, the sun and moon.

const SHEET = 'M20 3C10.6 3 5 10.2 5 19.5V42.5q2.5 3.8 5 0q2.5 3.8 5 0q2.5 3.8 5 0q2.5 3.8 5 0q2.5 3.8 5 0q2.5 3.8 5 0V19.5C35 10.2 29.4 3 20 3Z';

const FACES = {
  // Wide round eyes and a small o of surprise, with a curl of mist on top.
  wisp: `<path d="M20 3c-1-2.4.6-3.4 2.4-2.6" fill="none" stroke="var(--sheet)" stroke-width="2.4" stroke-linecap="round"/>
    <ellipse cx="14.6" cy="20" rx="3" ry="3.6" fill="var(--eye)"/><ellipse cx="25.4" cy="20" rx="3" ry="3.6" fill="var(--eye)"/>
    <ellipse cx="20" cy="28.5" rx="2" ry="2.6" fill="var(--eye)"/>`,
  // Heavy-lidded eyes, a patient smile and a bow.
  maud: `<path d="M11.4 20.6q3.2 2.6 6.4 0M22.2 20.6q3.2 2.6 6.4 0" fill="none" stroke="var(--eye)" stroke-width="2.3" stroke-linecap="round"/>
    <path d="M16.5 28q3.5 2.4 7 0" fill="none" stroke="var(--eye)" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M27 6.5l-5.5-3.2v6.4Zm0 0 5.5-3.2v6.4Z" fill="var(--bow)"/><circle cx="27" cy="6.5" r="1.6" fill="var(--bow)"/>`,
  // Narrow eyes, one raised brow, a thin smile and a top hat.
  hollis: `<path d="M11.8 16.4l6 1.4M22.4 17.8l5.6-2.4" stroke="var(--eye)" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M12 21.4h5.6M22.4 21.4H28" stroke="var(--eye)" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M15.5 28.4q5 2.4 9.6-1.2" fill="none" stroke="var(--eye)" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M12.4 6.6h15.2v1.9H12.4Zm2.3-7.6h10.6v7.6H14.7Z" fill="var(--hat)"/><path d="M14.7 4.6h10.6v1.4H14.7Z" fill="var(--band)"/>`,
};

export function ghostSvg(id, cls = '') {
  return `<svg class="ghost-art ${cls}" viewBox="0 -2 40 48" aria-hidden="true"><path d="${SHEET}" fill="var(--sheet)"/>${FACES[id] || FACES.wisp}</svg>`;
}

/** A candle that burns down a step for every letter of GHOST. */
export function candleSvg(letters = 0, lit = true) {
  const h = 30 - letters * 4.6;
  const top = 44 - h;
  return `<svg class="candle-art" viewBox="0 0 40 48" aria-hidden="true">
    <ellipse cx="20" cy="44.5" rx="12" ry="2.6" fill="var(--dish)"/>
    <rect x="13.5" y="${top}" width="13" height="${h}" rx="2" fill="var(--wax)"/>
    <path d="M13.5 ${top + 2}q3 3 6-.5 3.2 4 7 .5" fill="none" stroke="var(--wax-hi)" stroke-width="1.3" opacity=".7"/>
    <path d="M20 ${top}v-3" stroke="var(--wick)" stroke-width="1.4" stroke-linecap="round"/>
    ${lit
      ? `<g class="flame"><ellipse cx="20" cy="${top - 7}" rx="7" ry="9" fill="var(--glow)" opacity=".35"/><path d="M20 ${top - 14}c3.6 4.4 4.6 7.2 4.6 9.2a4.6 4.6 0 0 1-9.2 0c0-2 1-4.8 4.6-9.2Z" fill="var(--flame)"/><path d="M20 ${top - 7.6}c1.4 1.8 1.9 2.8 1.9 3.6a1.9 1.9 0 0 1-3.8 0c0-.8.5-1.8 1.9-3.6Z" fill="var(--flame-core)"/></g>`
      : `<path class="smoke" d="M20 ${top - 3}c-3-3 3-5 0-8s3-5 0-8" fill="none" stroke="var(--smoke)" stroke-width="1.4" stroke-linecap="round"/>`}
  </svg>`;
}

export const PLANCHETTE = `<svg viewBox="0 0 100 112" aria-hidden="true">
  <defs>
    <radialGradient id="pl-wood" cx=".45" cy=".35" r=".8"><stop offset="0" stop-color="#fbf3e2"/><stop offset=".7" stop-color="#e9d8b8"/><stop offset="1" stop-color="#c9ad80"/></radialGradient>
    <radialGradient id="pl-glass" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".45" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#5b3a1d" stop-opacity=".12"/></radialGradient>
    <mask id="pl-hole"><rect width="100" height="112" fill="#fff"/><circle cx="50" cy="60" r="17" fill="#000"/></mask>
  </defs>
  <path mask="url(#pl-hole)" d="M50 3C37 21 5 43 5 73c0 22 20 36 38 28 3-1.5 5.4-3.6 7-6 1.6 2.4 4 4.5 7 6 18 8 38-6 38-28C95 43 63 21 50 3Z" fill="url(#pl-wood)" stroke="#5a391c" stroke-width="2.4"/>
  <path mask="url(#pl-hole)" d="M50 12C40 26 14 45 14 72c0 16 14 26 28 20" fill="none" stroke="#5a391c" stroke-width="1" opacity=".45"/>
  <circle cx="50" cy="60" r="17" fill="url(#pl-glass)" stroke="#5a391c" stroke-width="2.4"/>
  <circle cx="50" cy="60" r="20.5" fill="none" stroke="#5a391c" stroke-width="1" opacity=".5"/>
  <path d="M40 51a13 13 0 0 1 9-5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".7"/>
</svg>`;
// Where the middle of the window is, as a fraction of the planchette's width and height.
export const WINDOW = { x: 50 / 100, y: 60 / 112 };

export const SUN = `<svg viewBox="0 0 40 40" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
  <circle cx="20" cy="20" r="8.5"/><path d="M20 3.5v5M20 31.5v5M3.5 20h5M31.5 20h5M8.3 8.3l3.5 3.5M28.2 28.2l3.5 3.5M8.3 31.7l3.5-3.5M28.2 11.8l3.5-3.5"/>
  <path d="M16.5 18.2h.01M23.5 18.2h.01" stroke-width="2.4"/><path d="M16.4 23q3.6 2.8 7.2 0"/></g></svg>`;
export const MOON = `<svg viewBox="0 0 40 40" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M25 5.5A15 15 0 1 0 34.5 27 12 12 0 0 1 25 5.5Z"/><path d="M15.5 17.5h.01" stroke-width="2.4"/><path d="M13.6 24.2q3 1.8 6.2 0"/>
  <path d="M33 8.5l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9Z" stroke-width="1.1"/></g></svg>`;
