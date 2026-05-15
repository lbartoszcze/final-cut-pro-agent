// Motion + scene analysis. Pure ffmpeg, no third-party CV deps.
//
//   analyzeMotion(path)   → { motionAvg, motionStd, satAvg, lumaAvg, frames }
//   detectScenes(path, t) → [ { tSec, score }, ... ]
//
// Both helpers downscale to 160x90 @ 10 fps before measuring; that keeps cost
// to ~1-2s per clip even for 4K masters while preserving the relative ordering
// of motion / saturation across clips.

import { spawnSync } from "node:child_process";

const SAMPLE_FPS = 10;
const ANALYZE_W = 160;
const ANALYZE_H = 90;

function runFfmpeg(args) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
  return r.stderr || "";
}

// Parse `[Parsed_metadata_X @ 0x...] lavfi.signalstats.KEY=VALUE` lines.
// signalstats writes one block of these per processed frame.
function parseSignalstats(stderr) {
  const ydif = [], sat = [], luma = [];
  for (const line of stderr.split("\n")) {
    let m;
    if ((m = line.match(/lavfi\.signalstats\.YDIF=([\d.\-eE]+)/))) ydif.push(parseFloat(m[1]));
    else if ((m = line.match(/lavfi\.signalstats\.SATAVG=([\d.\-eE]+)/))) sat.push(parseFloat(m[1]));
    else if ((m = line.match(/lavfi\.signalstats\.YAVG=([\d.\-eE]+)/))) luma.push(parseFloat(m[1]));
  }
  return { ydif, sat, luma };
}

function mean(xs) {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stdev(xs, m) {
  if (xs.length < 2) return 0;
  let s = 0;
  for (const x of xs) { const d = x - m; s += d * d; }
  return Math.sqrt(s / (xs.length - 1));
}

export function analyzeMotion(clipPath) {
  const filter = `scale=${ANALYZE_W}:${ANALYZE_H},fps=${SAMPLE_FPS},signalstats,metadata=print`;
  const stderr = runFfmpeg(["-i", clipPath, "-an", "-vf", filter, "-f", "null", "-"]);
  const { ydif, sat, luma } = parseSignalstats(stderr);
  const motionAvg = mean(ydif);
  return {
    motionAvg,
    motionStd: stdev(ydif, motionAvg),
    satAvg: mean(sat),
    lumaAvg: mean(luma),
    frames: ydif.length,
  };
}

// `scdet=t=N` emits a metadata key `lavfi.scd.score` for every frame whose
// scene-change score exceeds N (default 10). Returns the timestamps.
export function detectScenes(clipPath, threshold = 12) {
  const filter = `scale=${ANALYZE_W}:${ANALYZE_H},scdet=threshold=${threshold},metadata=print`;
  const stderr = runFfmpeg(["-i", clipPath, "-an", "-vf", filter, "-f", "null", "-"]);
  const scenes = [];
  let pendingTime = null;
  for (const line of stderr.split("\n")) {
    let m;
    if ((m = line.match(/pts_time:([\d.]+)/))) pendingTime = parseFloat(m[1]);
    else if ((m = line.match(/lavfi\.scd\.score=([\d.]+)/)) && pendingTime !== null) {
      scenes.push({ tSec: pendingTime, score: parseFloat(m[1]) });
      pendingTime = null;
    }
  }
  return scenes;
}

// Compose: split a clip into shots at detected scene cuts, then score each
// shot's motion. Returns array of { start, end, motionAvg, motionStd, satAvg, lumaAvg }
// where start/end are seconds within the source clip.
export function analyzeShots(clipPath, totalSec, sceneThreshold = 12) {
  const scenes = detectScenes(clipPath, sceneThreshold);
  const bounds = [0, ...scenes.map((s) => s.tSec), totalSec];
  bounds.sort((a, b) => a - b);
  const dedup = [bounds[0]];
  for (let i = 1; i < bounds.length; i++) {
    if (bounds[i] - dedup[dedup.length - 1] >= 0.5) dedup.push(bounds[i]);
  }
  if (dedup[dedup.length - 1] < totalSec - 0.1) dedup.push(totalSec);
  // For each shot, sample motion in just that window via -ss / -t.
  const shots = [];
  for (let i = 0; i < dedup.length - 1; i++) {
    const start = dedup[i], end = dedup[i + 1];
    if (end - start < 0.5) continue;
    const filter = `scale=${ANALYZE_W}:${ANALYZE_H},fps=${SAMPLE_FPS},signalstats,metadata=print`;
    const stderr = runFfmpeg(["-ss", start.toFixed(3), "-i", clipPath, "-t", (end - start).toFixed(3), "-an", "-vf", filter, "-f", "null", "-"]);
    const { ydif, sat, luma } = parseSignalstats(stderr);
    const motionAvg = mean(ydif);
    shots.push({
      start, end,
      motionAvg,
      motionStd: stdev(ydif, motionAvg),
      satAvg: mean(sat),
      lumaAvg: mean(luma),
    });
  }
  return shots;
}
