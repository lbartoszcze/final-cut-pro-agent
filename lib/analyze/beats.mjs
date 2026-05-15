// Beat / tempo detection from an audio file. No external deps beyond ffmpeg.
//
// Pipeline:
//   1. Decode the file via ffmpeg to mono 11025 Hz PCM-16, band-limited to
//      20-200 Hz so the kick/bass dominates the energy envelope.
//   2. Compute frame energy in ~23 ms hops (256 samples), take its half-wave
//      rectified time derivative — this is the onset-strength signal that
//      mirrors what aubio/librosa's spectral-flux onset detector produces on
//      kick-heavy material.
//   3. Autocorrelate the onset envelope over the lag range corresponding to
//      [60, 200] BPM, weighted by a log-Rayleigh prior centered at 120 BPM
//      to break the standard octave-error tie.
//   4. Fix downbeat phase by sliding a beat grid of the chosen period across
//      the onset envelope and picking the offset that maximises summed energy.
//
// Returns: { bpm, beatPeriodSec, downbeatOffsetSec, confidence }
// confidence is the unnormalised ACF peak — only useful for comparing two
// runs of the same audio, not absolute.

import { spawnSync } from "node:child_process";

const SR = 11025;
const HOP = 256;
const MIN_BPM = 60;
const MAX_BPM = 200;
const PRIOR_CENTER = 120;
const PRIOR_SIGMA = 0.55;

function decodeKickBand(audioPath) {
  const r = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-i", audioPath, "-vn",
    "-ac", "1", "-ar", String(SR),
    "-af", "highpass=f=20,lowpass=f=200",
    "-f", "s16le", "pipe:1",
  ], { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error("beat-detect ffmpeg failed:\n" + (r.stderr?.toString() || "").slice(-2000));
  }
  const buf = r.stdout;
  return new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
}

function onsetEnvelope(pcm) {
  const frames = Math.floor(pcm.length / HOP);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = 0; i < HOP; i++) {
      const s = pcm[f * HOP + i] / 32768;
      sum += s * s;
    }
    energy[f] = Math.sqrt(sum / HOP);
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const d = energy[f] - energy[f - 1];
    onset[f] = d > 0 ? d : 0;
  }
  let max = 0;
  for (let i = 0; i < onset.length; i++) if (onset[i] > max) max = onset[i];
  if (max > 0) for (let i = 0; i < onset.length; i++) onset[i] /= max;
  return onset;
}

function tempoPrior(bpm) {
  const x = Math.log2(bpm / PRIOR_CENTER);
  return Math.exp(-(x * x) / (2 * PRIOR_SIGMA * PRIOR_SIGMA));
}

function autocorrelateTempo(onset, hopSec) {
  const minLag = Math.max(2, Math.round(60 / MAX_BPM / hopSec));
  const maxLag = Math.min(onset.length - 2, Math.round(60 / MIN_BPM / hopSec));
  const acf = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    const n = onset.length - lag;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += onset[i] * onset[i + lag];
    acf[lag] = sum / n;
  }
  let bestLag = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * hopSec);
    const score = acf[lag] * tempoPrior(bpm);
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  // Parabolic-interpolation refinement around the discrete ACF peak gives
  // sub-frame precision. With HOP=256 @ 11025 Hz the raw grid is ~23 ms so a
  // 120-BPM source quantises to ~5 BPM steps; this fix drops the residual to
  // <0.5 BPM without any extra ACF passes.
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = acf[bestLag - 1], b = acf[bestLag], c = acf[bestLag + 1];
    const denom = (a - 2 * b + c);
    if (denom !== 0) {
      const delta = 0.5 * (a - c) / denom;
      if (Math.abs(delta) < 1) refinedLag = bestLag + delta;
    }
  }
  return { bestLag: refinedLag, bestScore };
}

function findDownbeatPhase(onset, bestLag) {
  // bestLag may be fractional after parabolic refinement; round for the
  // phase search because phase still lives on integer frame indices.
  const lag = Math.max(1, Math.round(bestLag));
  let bestPhase = 0, bestSum = -Infinity;
  for (let phase = 0; phase < lag; phase++) {
    let sum = 0;
    for (let i = phase; i < onset.length; i += lag) sum += onset[i];
    if (sum > bestSum) { bestSum = sum; bestPhase = phase; }
  }
  return bestPhase;
}

export function detectTempo(audioPath) {
  const pcm = decodeKickBand(audioPath);
  if (pcm.length < SR * 4) throw new Error("audio too short for tempo detection (<4s)");
  const onset = onsetEnvelope(pcm);
  const hopSec = HOP / SR;
  const { bestLag, bestScore } = autocorrelateTempo(onset, hopSec);
  const phaseFrames = findDownbeatPhase(onset, bestLag);
  const beatPeriodSec = bestLag * hopSec;
  return {
    bpm: 60 / beatPeriodSec,
    beatPeriodSec,
    downbeatOffsetSec: phaseFrames * hopSec,
    confidence: bestScore,
  };
}

export function snapTempo(bpm) {
  const r = Math.round(bpm);
  return Math.abs(bpm - r) < 0.6 ? r : Math.round(bpm * 2) / 2;
}

// Source-audio energy onsets — used for snapping cuts in dialogue/podcast
// content. Full broadband decode (no kick-band filter) at 11025 Hz, ~23 ms
// hop. Returns onset times in seconds above the given strength percentile.
// Cuts placed near these times sound natural; cuts mid-syllable do not.
export function detectAudioOnsets(audioPath, percentile = 0.85) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", audioPath, "-vn", "-ac", "1", "-ar", String(SR), "-f", "s16le", "pipe:1"], { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("audio-onset ffmpeg failed:\n" + (r.stderr?.toString() || "").slice(-1000));
  const pcm = new Int16Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength / 2);
  if (pcm.length < SR * 1) return [];
  const onset = onsetEnvelope(pcm);
  const sorted = Array.from(onset).sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * percentile)] || 0;
  const out = [];
  const hopSec = HOP / SR;
  const minGapFrames = Math.max(1, Math.round(0.1 / hopSec));
  let lastIdx = -minGapFrames;
  for (let i = 0; i < onset.length; i++) {
    if (onset[i] >= threshold && i - lastIdx >= minGapFrames) {
      out.push(i * hopSec);
      lastIdx = i;
    }
  }
  return out;
}

// Snap each cut's tOnTimeline (in seconds) to the nearest onset within
// snapTolerance. Returns a new array; cuts whose nearest onset is too far
// away keep their original time. Onsets must be sorted ascending.
export function snapCutsToOnsets(cuts, onsets, snapTolerance) {
  if (!onsets || onsets.length === 0) return cuts;
  return cuts.map((c) => {
    let lo = 0, hi = onsets.length - 1, best = onsets[0], bestDiff = Math.abs(onsets[0] - c.tOnTimeline);
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const d = Math.abs(onsets[mid] - c.tOnTimeline);
      if (d < bestDiff) { bestDiff = d; best = onsets[mid]; }
      if (onsets[mid] < c.tOnTimeline) lo = mid + 1; else hi = mid - 1;
    }
    if (bestDiff <= snapTolerance) return { ...c, tOnTimeline: best };
    return c;
  });
}
