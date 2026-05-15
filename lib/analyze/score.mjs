// Section-aware shot picker. Consumes analyzeShots() output from motion.mjs
// and replaces the round-robin pickClipIndex used by the cadence planner.
//
// Strategy:
//   - The opening hook (first cut of bar 0) gets the single highest-motion
//     shot in the whole pool — the strongest content goes first.
//   - Chorus sections draw from the top 60% of motion-ranked shots, so a 16
//     bar arrangement's chorus is consistently high-energy.
//   - Intro draws from the middle 50% (medium motion, deliberate).
//   - Verse draws from the bottom 50% (low motion lets dialogue / negative
//     space breathe).
//   - Outro draws from the bottom 30% (gentle wind-down).
//   - Within each pool, cuts round-robin so we don't keep selecting the same
//     "best" shot.
//
// All-zero motion (e.g. test patterns) collapses to ordinal round robin over
// the original shot order so the cadence planner still produces varied cuts
// rather than emitting the same first shot repeatedly.

function shotsAsFlat(shotsByClip) {
  const out = [];
  for (let c = 0; c < shotsByClip.length; c++) {
    for (let s = 0; s < shotsByClip[c].length; s++) {
      out.push({ clipIdx: c, shotIdx: s, ...shotsByClip[c][s] });
    }
  }
  return out;
}

function sliceFraction(sorted, lo, hi) {
  const a = Math.floor(sorted.length * lo);
  const b = Math.ceil(sorted.length * hi);
  return sorted.slice(a, Math.max(a + 1, b));
}

// Composite score blending motion + face presence. Faces strongly bias the
// hook and chorus toward people-bearing shots, which is the standard
// "Hollywood" cue for emotional beats.
function compositeScore(shot, faceWeight) {
  const face = shot.faceFraction || 0;
  return shot.motionAvg + faceWeight * face * 5;
}

// Build per-section pools once for a given corpus of analyzed shots.
// hookPool is the top N composite-score shots used for the opening 3-5s
// window; chorus prefers high motion + face; verse prefers low motion.
export function rankShots(shotsByClip) {
  const all = shotsAsFlat(shotsByClip);
  if (all.length === 0) return null;
  const maxMotion = all.reduce((m, s) => Math.max(m, s.motionAvg), 0);
  if (maxMotion === 0) {
    return { hook: all[0], hookPool: all.slice(0, Math.max(1, Math.ceil(all.length * 0.3))), chorus: all, verse: all, intro: all, outro: all };
  }
  const desc = [...all].sort((a, b) => compositeScore(b, 1) - compositeScore(a, 1));
  const asc = [...all].sort((a, b) => a.motionAvg - b.motionAvg);
  return {
    hook: desc[0],
    hookPool: sliceFraction(desc, 0, 0.3),
    chorus: sliceFraction(desc, 0, 0.6),
    intro: sliceFraction(asc, 0.25, 0.75),
    verse: sliceFraction(asc, 0, 0.5),
    outro: sliceFraction(asc, 0, 0.3),
  };
}

// One short B-roll cutaway per chorus section, drawn from hookPool. Returns
// [ { clipIdx, srcInSec, durSec, tOnTimeline } ]. Pure time math against the
// section labels (no ffmpeg shells), so both build.mjs and make-cut.mjs use it.
export function planBrolls(ranked, sectionOf, bars, barSec) {
  if (!ranked || !ranked.hookPool || ranked.hookPool.length === 0) return [];
  const out = [];
  let secStartBar = 0, secLabel = null, bi = 0;
  for (let bar = 0; bar <= bars; bar++) {
    const lbl = bar < bars ? sectionOf(bar, bars) : null;
    if (lbl !== secLabel) {
      if (secLabel === "chorus") {
        const shot = ranked.hookPool[bi % ranked.hookPool.length]; bi++;
        out.push({ clipIdx: shot.clipIdx, srcInSec: shot.start, durSec: Math.min(barSec, shot.end - shot.start - 0.05), tOnTimeline: secStartBar * barSec + barSec / 3 });
      }
      secStartBar = bar; secLabel = lbl;
    }
  }
  return out;
}

// Match-cut score between two shots: visual continuity at the cut boundary.
// Weights luma > saturation > motion magnitude since luma jumps are the most
// jarring at a cut. Returns 0..1 (1 = perfect match).
export function matchScore(a, b) {
  if (!a || !b) return 0;
  const dLuma = Math.abs(a.lumaAvg - b.lumaAvg) / 255;
  const dSat = Math.abs(a.satAvg - b.satAvg) / 255;
  const mMax = Math.max(0.001, a.motionAvg, b.motionAvg);
  const dMotion = Math.abs(a.motionAvg - b.motionAvg) / mMax;
  return Math.max(0, 1 - 0.5 * dLuma - 0.3 * dSat - 0.2 * dMotion);
}

// Pick a shot ref for one cut. hookIdx >= 0 means this cut belongs to the
// opening-hook window and should round-robin within hookPool; <0 falls back
// to the section pool indexed by cutInSection. When prevShot is supplied, the
// picker round-robins within the top-third match-cut neighbours of the pool
// so adjacent cuts share luma/saturation/motion characteristics where the
// pool allows it.
export function pickShotForCut(ranked, section, cutInSection, hookIdx, prevShot) {
  if (!ranked) return null;
  const isHook = Number.isInteger(hookIdx) && hookIdx >= 0;
  const pool = isHook
    ? (ranked.hookPool || [ranked.hook])
    : (ranked[section] || ranked.verse || [ranked.hook]);
  if (!pool || pool.length === 0) return ranked.hook;
  const idx = isHook ? hookIdx : cutInSection;
  if (!prevShot || pool.length < 3) return pool[idx % pool.length];
  const ranked2 = pool.map((c) => ({ c, s: matchScore(prevShot, c) })).sort((x, y) => y.s - x.s);
  const k = Math.max(3, Math.ceil(pool.length / 3));
  const top = ranked2.slice(0, k).map((r) => r.c);
  return top[idx % top.length];
}
