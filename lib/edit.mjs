// Procedural arrangement helpers — cut cadence, sections, transitions,
// title scheduling. Pure functions; deterministic given the seeded RNG.
// Imported by make-cut.mjs and by lib/render/build.mjs.

let _seed = 0x9e3779b9 >>> 0;
function rand() {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  return _seed / 0xffffffff;
}
export function reseed(s) { _seed = s >>> 0; }

// Section labels for an N-bar arrangement. Same layout as lib/production.mjs
// in the Logic agent so cadence matches a musical track when the FCP cut is
// synced to a beat.
export function sectionOf(barIdx, totalBars) {
  if (totalBars <= 4) return "verse";
  if (totalBars <= 8) return barIdx < 4 ? "intro" : "chorus";
  if (totalBars <= 12) {
    if (barIdx < 4) return "intro";
    if (barIdx < 8) return "verse";
    return "chorus";
  }
  const phrase = Math.floor(barIdx / 4);
  const totalPhrases = Math.floor(totalBars / 4);
  if (phrase === 0) return "intro";
  if (phrase === totalPhrases - 1) return "outro";
  return phrase % 2 === 1 ? "verse" : "chorus";
}

// Cuts-per-bar for each section under each style. Higher = more frantic.
const CADENCE = {
  montage:   { intro: 1, verse: 4, chorus: 8, outro: 2 },
  cinematic: { intro: 1, verse: 2, chorus: 2, outro: 1 },
  "jump-cut":{ intro: 2, verse: 6, chorus: 8, outro: 4 },
  "slow-mo": { intro: 1, verse: 1, chorus: 2, outro: 1 },
};
export function cutsPerBar(style, section) {
  const tbl = CADENCE[style] || CADENCE.montage;
  return tbl[section] ?? 4;
}

// Plan one bar of cuts. Returns array of {beatStart, beatLen} relative to bar.
// Lengths are randomised within +/- 25% of the nominal so cuts feel hand-made.
export function planBarCuts(style, bars, barIdx) {
  const sec = sectionOf(barIdx, bars);
  const n = cutsPerBar(style, sec);
  const slot = 4 / n; // beats per cut
  const out = [];
  let t = 0;
  for (let i = 0; i < n; i++) {
    const jitter = 1 + (rand() - 0.5) * 0.5;
    const len = slot * jitter;
    out.push({ beatStart: t, beatLen: Math.min(len, 4 - t) });
    t += len;
    if (t >= 4) break;
  }
  if (out.length && out[out.length - 1].beatStart + out[out.length - 1].beatLen < 4) {
    out[out.length - 1].beatLen = 4 - out[out.length - 1].beatStart;
  }
  return out;
}

// Cross-dissolve at a section boundary. Cinematic dissolves are long, jump-cut
// dissolves are zero (hard cut). Returns frames duration or 0 for hard cut.
export function transitionFrames(style, atSectionBoundary, fps) {
  if (!atSectionBoundary) return 0;
  if (style === "jump-cut") return 0;
  if (style === "cinematic") return Math.round(fps * 0.8);
  if (style === "slow-mo") return Math.round(fps * 1.0);
  return Math.round(fps * 0.4);
}

// Title cards are placed at the start of every chorus section, plus an opener
// at bar 0 and a closer at the start of outro. Returns array of
// {barIdx, text, holdBars}.
export function planTitles(bars, projectName) {
  const out = [];
  out.push({ barIdx: 0, text: projectName, holdBars: 2 });
  for (let bar = 0; bar < bars; bar++) {
    const here = sectionOf(bar, bars);
    const prev = bar > 0 ? sectionOf(bar - 1, bars) : null;
    if (here === "chorus" && prev !== "chorus") {
      out.push({ barIdx: bar, text: `Chapter ${out.length}`, holdBars: 1 });
    }
    if (here === "outro" && prev !== "outro") {
      out.push({ barIdx: bar, text: "fin.", holdBars: 1 });
    }
  }
  return out;
}

// Pick a clip index for each cut. Round-robin with a cinematic exception:
// repeat the previous clip on consecutive cuts in slow-mo so the same shot
// breathes across multiple beats.
export function pickClipIndex(style, cutIdx, clipCount) {
  if (clipCount === 0) return 0;
  if (style === "slow-mo" && cutIdx > 0 && rand() < 0.5) {
    return (cutIdx - 1) % clipCount;
  }
  return cutIdx % clipCount;
}
