// Topographic artwork: fine contour lines, like a map of rolling land.
// Each experience gets its own landscape, made from its title, so it is always the same.
// Nothing here uses a library: a few soft hills are added together into a height
// map, and "marching squares" traces the lines where the height crosses a level.

// A small, stable number made from text (FNV-1a).
export function hash(text) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Random numbers from a seed (mulberry32): the same seed gives the same sequence.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Five deep, quiet tones for the background. Each goes from a lighter corner to a darker one.
export const TONES = [
  { from: "#34224d", to: "#1d1030" }, // plum
  { from: "#1d2e48", to: "#101a2b" }, // navy
  { from: "#1e3b34", to: "#10241f" }, // pine
  { from: "#34313b", to: "#1d1b22" }, // graphite
  { from: "#4a2232", to: "#2b121c" }, // claret
];

const WIDTH = 320;
const HEIGHT = 180;
const CELL = 5; // size of one square in the height map
const COLS = WIDTH / CELL;
const ROWS = HEIGHT / CELL;
const LEVELS = 12; // how many contour lines

const cache = new Map();

// The lines for one seed: [{ d: "M... L...", major: true | false }, ...].
// Every third line is a "major" line and is drawn a little stronger, as on a real map.
export function contourLines(seed) {
  if (cache.has(seed)) return cache.get(seed);

  const rand = random(seed);
  const hills = Array.from({ length: 3 + Math.floor(rand() * 3) }, () => ({
    x: rand() * WIDTH,
    y: rand() * HEIGHT,
    height: 0.55 + rand() * 0.45,
    spreadX: 40 + rand() * 70,
    spreadY: 24 + rand() * 40,
  }));
  const phase = rand() * 6.28;

  const heightAt = (x, y) => {
    let total = 0.06 * Math.sin(x / 21 + phase) * Math.cos(y / 15 - phase); // a little ripple
    for (const hill of hills) {
      const dx = (x - hill.x) / hill.spreadX;
      const dy = (y - hill.y) / hill.spreadY;
      total += hill.height * Math.exp(-(dx * dx + dy * dy) / 2);
    }
    return total;
  };

  // Measure the height at every corner of every square.
  const grid = [];
  let low = Infinity;
  let high = -Infinity;
  for (let row = 0; row <= ROWS; row++) {
    const line = [];
    for (let col = 0; col <= COLS; col++) {
      const value = heightAt(col * CELL, row * CELL);
      line.push(value);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    grid.push(line);
  }

  const lines = [];
  for (let level = 1; level <= LEVELS; level++) {
    const at = low + ((high - low) * level) / (LEVELS + 1);
    lines.push({ d: tracePath(grid, at), major: level % 3 === 0 });
  }

  cache.set(seed, lines);
  return lines;
}

// Marching squares: look at each square of the map. If some corners are above the
// level and some below, the line passes through, and we draw it across the square.
function tracePath(grid, at) {
  const round = (n) => Math.round(n * 10) / 10;
  let d = "";
  const link = (p, q) => {
    d += `M${round(p[0])} ${round(p[1])}L${round(q[0])} ${round(q[1])}`;
  };

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const a = grid[row][col]; // top left
      const b = grid[row][col + 1]; // top right
      const c = grid[row + 1][col + 1]; // bottom right
      const e = grid[row + 1][col]; // bottom left

      // Which corners are above the level, as a number from 0 to 15.
      const kind = (a >= at ? 8 : 0) | (b >= at ? 4 : 0) | (c >= at ? 2 : 0) | (e >= at ? 1 : 0);
      if (kind === 0 || kind === 15) continue;

      // Where the line would cross each edge of the square.
      const x = col * CELL;
      const y = row * CELL;
      const top = [x + (CELL * (at - a)) / (b - a), y];
      const right = [x + CELL, y + (CELL * (at - b)) / (c - b)];
      const bottom = [x + (CELL * (at - e)) / (c - e), y + CELL];
      const left = [x, y + (CELL * (at - a)) / (e - a)];

      switch (kind) {
        case 1: case 14: link(left, bottom); break;
        case 2: case 13: link(bottom, right); break;
        case 3: case 12: link(left, right); break;
        case 4: case 11: link(top, right); break;
        case 6: case 9: link(top, bottom); break;
        case 7: case 8: link(top, left); break;
        case 5: link(top, left); link(bottom, right); break; // two lines meet in this square
        case 10: link(top, right); link(left, bottom); break;
      }
    }
  }
  return d;
}
