// Probe + format helpers for FCPXML authoring. ffprobe/ffmpeg are used here
// only to MEASURE source clips so the emitted FCPXML carries correct
// per-clip <adjust-volume> gain and a correct <format> (width/height/
// frameDuration). No video is rendered here — Final Cut Pro renders the
// project. The filename is retained so make-cut.mjs imports stay stable.

import { spawnSync } from "node:child_process";

// Whether the file has at least one audio stream. Per-clip <adjust-volume>
// is only emitted for clips that actually carry audio; a probe that fails is
// the failure, not a silent clip.
export function ffprobeHasAudio(path) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path], { encoding: "utf8" });
  if (r.error || r.status || r.signal) {
    throw new Error(`ffprobe could not read the audio streams of ${path}: ${r.error ? r.error.message : r.stderr.trim()}`);
  }
  return Boolean(r.stdout.trim());
}

// loudnorm measure-only pass → integrated loudness + true peak. make-cut.mjs
// converts this to a per-clip dB offset emitted as <adjust-volume> in the
// FCPXML so FCP applies the level match on its own render. Null only for a
// clip without audio; a measurement that fails is thrown with ffmpeg's words.
export function probeLoudness(path) {
  if (!ffprobeHasAudio(path)) return null;
  const r = spawnSync("ffmpeg", [
    "-hide_banner", "-nostats", "-i", path,
    "-vn", "-af", "loudnorm=print_format=json",
    "-f", "null", "-",
  ], { encoding: "utf8" });
  if (r.error || r.status || r.signal) {
    throw new Error(`ffmpeg loudness measurement of ${path} failed: ${r.error ? r.error.message : r.stderr.trim()}`);
  }
  // The last {...} ffmpeg printed is loudnorm's measurement.
  const printed = /\{[^{}]*\}(?![\s\S]*\{)/.exec(r.stderr);
  if (!printed) throw new Error(`ffmpeg printed no loudnorm measurement for ${path}: ${r.stderr.trim()}`);
  let obj;
  try {
    obj = JSON.parse(printed[0]);
  } catch (error) {
    throw new Error(`ffmpeg's loudnorm measurement for ${path} does not parse (${error.message}): ${printed[0]}`);
  }
  return {
    inputI: parseFloat(obj.input_i),
    inputTP: parseFloat(obj.input_tp),
    inputLRA: parseFloat(obj.input_lra),
  };
}

// Distribution-platform presets — one --platform=<name> fills audio loudness
// target, length cap, aspect, fps for the emitted FCPXML project/format.
export const PLATFORMS = {
  "youtube":            { audioTarget: -14, maxDuration: null, aspect: "16:9",      fps: "29.97" },
  "youtube-shorts":     { audioTarget: -14, maxDuration: 60,   aspect: "9:16:fill", fps: "29.97" },
  "tiktok":             { audioTarget: -14, maxDuration: 60,   aspect: "9:16:fill", fps: "29.97" },
  "reels":              { audioTarget: -14, maxDuration: 90,   aspect: "9:16:fill", fps: "29.97" },
  "instagram-feed":     { audioTarget: -14, maxDuration: 60,   aspect: "1:1:fill",  fps: "29.97" },
  "instagram-portrait": { audioTarget: -14, maxDuration: 60,   aspect: "4:5:fill",  fps: "29.97" },
  "twitter":            { audioTarget: -14, maxDuration: 140,  aspect: "16:9",      fps: "29.97" },
  "broadcast":          { audioTarget: -23, maxDuration: null, aspect: "16:9",      fps: "25" },
  "broadcast-us":       { audioTarget: -24, maxDuration: null, aspect: "16:9",      fps: "29.97" },
  "cinema":             { audioTarget: -23, maxDuration: null, aspect: "2.35:1",    fps: "24" },
};

export function resolvePlatform(name) {
  if (!name) return null;
  const p = PLATFORMS[name];
  if (!p) throw new Error(`unknown --platform: ${name}. Known: ${Object.keys(PLATFORMS).join(", ")}`);
  return p;
}

// Frame-rate spec → {num, den, label}. Drives FCPXML <format frameDuration>.
export function parseFps(spec) {
  const known = {
    "23.976": { num: 24000, den: 1001 }, "23.98": { num: 24000, den: 1001 }, "24000/1001": { num: 24000, den: 1001 },
    "24": { num: 24, den: 1 },
    "25": { num: 25, den: 1 },
    "29.97": { num: 30000, den: 1001 }, "30000/1001": { num: 30000, den: 1001 },
    "30": { num: 30, den: 1 },
    "50": { num: 50, den: 1 },
    "59.94": { num: 60000, den: 1001 }, "60000/1001": { num: 60000, den: 1001 },
    "60": { num: 60, den: 1 },
  };
  if (!spec) return { num: 30000, den: 1001, label: "30000/1001" };
  const k = String(spec);
  if (known[k]) return { ...known[k], label: `${known[k].num}/${known[k].den}` };
  const slash = k.match(/^(\d+)\/(\d+)$/);
  if (slash) return { num: parseInt(slash[1]), den: parseInt(slash[2]), label: k };
  const num = parseFloat(k);
  if (Number.isFinite(num) && num > 0) {
    return { num: Math.round(num * 1000), den: 1000, label: `${Math.round(num * 1000)}/1000` };
  }
  return { num: 30000, den: 1001, label: "30000/1001" };
}

// Aspect spec → {w, h, mode}. Drives FCPXML <format> width/height.
export function parseAspect(spec) {
  if (!spec) return { w: 1920, h: 1080, mode: "fit" };
  const px = spec.match(/^(\d+)x(\d+)(?::(fit|fill))?$/i);
  if (px) return { w: parseInt(px[1]), h: parseInt(px[2]), mode: (px[3] || "fit").toLowerCase() };
  const ratio = spec.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)(?::(fit|fill))?$/i);
  if (ratio) {
    const a = parseFloat(ratio[1]), b = parseFloat(ratio[2]);
    const mode = (ratio[3] || "fit").toLowerCase();
    if (b >= a) return { w: 1080, h: Math.round(1080 * b / a), mode };
    return { w: Math.round(1080 * a / b), h: 1080, mode };
  }
  return { w: 1920, h: 1080, mode: "fit" };
}
