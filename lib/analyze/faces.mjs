// Face detection wrapper. Shells out to tools/face_detect.py (OpenCV
// haarcascade) sampled at 5 fps. Returns per-clip aggregate stats consumed by
// score.mjs to bias hook + chorus pools toward people-bearing shots.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "..", "tools", "face_detect.py");
const PY = "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12";

export function detectFaces(clipPath) {
  if (!existsSync(SCRIPT)) throw new Error(`face_detect.py missing at ${SCRIPT}`);
  const r = spawnSync(PY, [SCRIPT, clipPath], { encoding: "utf8", maxBuffer: 1024 * 1024 * 32 });
  const frames = faceFrames(r, clipPath);
  if (frames.length === 0) return { faceFraction: 0, peakFaceCount: 0, avgAreaPct: 0 };
  let withFace = 0, peak = 0, areaSum = 0;
  for (const f of frames) {
    if (f.n > 0) withFace++;
    if (f.n > peak) peak = f.n;
    areaSum += f.area_pct || 0;
  }
  return {
    faceFraction: withFace / frames.length,
    peakFaceCount: peak,
    avgAreaPct: areaSum / frames.length,
  };
}

// Mutate shotsByClip[i][j] in place adding faceFraction/peakFaceCount/avgAreaPct.
// One face-detect pass per clip, distributed across that clip's shots.
export function enrichShotsWithFaces(clipPaths, shotsByClip) {
  for (let i = 0; i < clipPaths.length; i++) {
    const fs = facesByShot(clipPaths[i], shotsByClip[i]);
    shotsByClip[i].forEach((s, j) => Object.assign(s, fs[j]));
  }
}

// Face stats per shot. We sample the full clip once and reuse the timeline
// to compute per-shot face fractions cheaply.
export function facesByShot(clipPath, shots) {
  if (!existsSync(SCRIPT)) throw new Error(`face_detect.py missing at ${SCRIPT}`);
  const r = spawnSync(PY, [SCRIPT, clipPath], { encoding: "utf8", maxBuffer: 1024 * 1024 * 32 });
  const frames = faceFrames(r, clipPath);
  return shots.map((s) => {
    const inWin = frames.filter((f) => f.t >= s.start && f.t < s.end);
    if (inWin.length === 0) return { faceFraction: 0, peakFaceCount: 0, avgAreaPct: 0 };
    let withFace = 0, peak = 0, areaSum = 0;
    for (const f of inWin) {
      if (f.n > 0) withFace++;
      if (f.n > peak) peak = f.n;
      areaSum += f.area_pct || 0;
    }
    return { faceFraction: withFace / inWin.length, peakFaceCount: peak, avgAreaPct: areaSum / inWin.length };
  });
}

// The sampled frames face_detect.py answered for `clipPath`. A run that could
// not start, failed, or printed something other than {"frames": [...]} is
// refused with its cause: a clip whose faces were never read is not a clip
// without faces.
function faceFrames(r, clipPath) {
  if (r.error || r.status || r.signal) {
    throw new Error(`face_detect.py failed on ${clipPath}: ${r.error ? r.error.message : r.stderr.trim()}`);
  }
  let answer;
  try {
    answer = JSON.parse(r.stdout);
  } catch (error) {
    throw new Error(`face_detect.py printed no JSON for ${clipPath} (${error.message}): ${r.stdout.trim()}`);
  }
  if (!Array.isArray(answer?.frames)) {
    throw new Error(`face_detect.py answered no frames list for ${clipPath}: ${r.stdout.trim()}`);
  }
  return answer.frames;
}
