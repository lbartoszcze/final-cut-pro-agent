// Direct video renderer. Bypasses Final Cut Pro — uses ffmpeg only.
// Mirrors logic-pro-agent/lib/render/audio.mjs in role: read same args
// the FCP-driving make-cut.mjs takes, produce a finished MP4 without
// launching FCP. Useful for fast iteration on cadence + titles.
//
// Run: node lib/render/video.mjs --style=montage --bpm=140 --bars=16 --clips=./footage
// Out: ./cut-rendered.mp4 (or --out path)

import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename, extname } from "node:path";
import { readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { build } from "./build.mjs";
import { ffmpeg, ffprobeDurationSec, renderClips, overlayTitles, renderColor, probeLoudness, parseAspect, parseFps, resolvePlatform } from "./ffmpeg.mjs";
import { parseTemplate, applyTemplate } from "./template.mjs";
import { resolveLook, lutFfmpegFilter } from "./grades.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".mkv", ".avi"]);

function parseArgs(argv) {
  const defaults = { mode: "test-pattern", style: "montage", bpm: "140", bars: "16", clips: "", out: join(ROOT, "cut-rendered.mp4"), template: "", look: "cinematic", "audio-target": "-16", "audio-fade": "0.05", aspect: "16:9", fps: "29.97", "fade-from-black": "0", "fade-to-black": "0", "max-duration": "", lut: "", platform: "" };
  const supplied = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.+)$/);
    if (m) supplied[m[1]] = m[2];
  }
  const out = { ...defaults, ...supplied };
  // --platform=<name> fills audio-target / max-duration / aspect / fps for
  // any of those the user did NOT explicitly pass. Per-flag overrides win.
  if (supplied.platform) {
    const p = resolvePlatform(supplied.platform);
    if (p) {
      if (!("audio-target" in supplied) && p.audioTarget != null) out["audio-target"] = String(p.audioTarget);
      if (!("max-duration" in supplied) && p.maxDuration != null) out["max-duration"] = String(p.maxDuration);
      if (!("aspect" in supplied) && p.aspect) out.aspect = p.aspect;
      if (!("fps" in supplied) && p.fps) out.fps = p.fps;
    }
  }
  if (out.clips) out.mode = "clips";
  return out;
}

function listClipsInFolder(folder) {
  const abs = resolve(folder);
  return readdirSync(abs)
    .filter((n) => VIDEO_EXT.has(extname(n).toLowerCase()))
    .map((n) => join(abs, n))
    .filter((p) => statSync(p).isFile())
    .sort();
}

function makeTestPatterns(workDir) {
  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });
  const palette = [
    "0x1a1a1a", "0x222831", "0x393e46",
    "0xeeeeee", "0xff5722", "0x00adb5",
  ];
  const out = [];
  for (let i = 0; i < palette.length; i++) {
    const path = join(workDir, `pattern-${i}.mp4`);
    if (!existsSync(path)) renderColor(palette[i], 8, path);
    out.push(path);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const bpm = parseInt(args.bpm);
const bars = parseInt(args.bars);
if (!Number.isFinite(bpm) || bpm < 30) throw new Error(`bad --bpm: ${args.bpm}`);
if (!Number.isFinite(bars) || bars < 1) throw new Error(`bad --bars: ${args.bars}`);

const clipPaths = args.mode === "clips"
  ? (args.clips ? listClipsInFolder(args.clips) : (() => { throw new Error("--mode=clips requires --clips"); })())
  : makeTestPatterns(join(ROOT, ".work", "patterns"));

if (clipPaths.length === 0) throw new Error("no source clips");

const clipDurations = clipPaths.map(ffprobeDurationSec);
const projectName = args.mode === "clips" ? basename(resolve(args.clips)).toUpperCase() : `${args.style.toUpperCase()} CUT`;

// Two paths: --template (borrow cadence from a reference) or cadence-driven build.
let plan;
if (args.template) {
  const tpl = parseTemplate(resolve(args.template));
  const resolved = applyTemplate(tpl, clipDurations);
  const cuts = [], transitions = [], titles = [];
  for (const r of resolved) {
    if (r.kind === "title") titles.push({ tOnTimeline: r.offsetSec, durSec: r.durSec, text: r.text || r.name || "Title" });
    else if (r.kind === "transition") transitions.push({ tOnTimeline: r.offsetSec, durSec: r.durSec, kind: "xfade" });
    else if (r.kind === "clip") cuts.push({ srcIdx: r.srcIdx, srcInSec: r.srcInSec, durSec: r.durSec, tOnTimeline: r.offsetSec });
  }
  plan = { cuts, transitions, titles, totalSec: tpl.totalSec || 30, beatSec: 0 };
  console.log(`Rendering template ${basename(args.template)} (${plan.totalSec.toFixed(1)}s) onto ${clipPaths.length} clips...`);
} else {
  plan = build(args.style, bars, bpm, { clipDurations, projectName, seed: (bpm * 1000 + bars) >>> 0 });
  console.log(`Rendering ${bars} bars of ${args.style} at ${bpm} BPM (${plan.totalSec.toFixed(1)}s) from ${clipPaths.length} clips...`);
}
console.log(`  cuts=${plan.cuts.length} transitions=${plan.transitions.length} titles=${plan.titles.length}`);

const tmpDir = join(ROOT, ".work");
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
const concatPath = join(tmpDir, "concat.mp4");

const look = resolveLook(args.look, clipPaths[0]);
let lookFfmpeg = look.ffmpeg;
if (args.lut) {
  const lutChain = lutFfmpegFilter(resolve(args.lut));
  lookFfmpeg = lookFfmpeg ? `${lookFfmpeg},${lutChain}` : lutChain;
  console.log(`  applying LUT: ${args.lut}`);
}
if (look.ffmpeg) console.log(`  applying look "${look.name}"${look.stats ? ` (auto: YAVG=${look.stats.YAVG?.toFixed?.(1)})` : ""}: ${look.description}`);

const audioTarget = args["audio-target"] === "off" ? null : parseFloat(args["audio-target"]);
const audioFadeSec = parseFloat(args["audio-fade"]);
let audioOpts = null;
if (audioTarget !== null && Number.isFinite(audioTarget)) {
  console.log(`  measuring per-clip loudness (target ${audioTarget} LUFS)...`);
  const perClipMeasured = clipPaths.map((p) => probeLoudness(p));
  audioOpts = { targetLUFS: audioTarget, fadeInSec: audioFadeSec, fadeOutSec: audioFadeSec, perClipMeasured };
  const audible = perClipMeasured.filter((m) => m && Number.isFinite(m.inputI) && m.inputI > -70).length;
  console.log(`    ${audible}/${clipPaths.length} clips have audio; rest will be silence-padded`);
}

const aspect = parseAspect(args.aspect);
const fps = parseFps(args.fps);
const fadeFromBlack = parseFloat(args["fade-from-black"]) || 0;
const fadeToBlack = parseFloat(args["fade-to-black"]) || 0;
const maxDur = args["max-duration"] ? parseFloat(args["max-duration"]) : null;
console.log(`  output aspect: ${aspect.w}x${aspect.h} (${aspect.mode}-fit) @ ${fps.label} fps`);

// Length-cap: drop cuts whose start is past max-duration, trim the boundary
// cut so it ends exactly on the cap.
let effectiveCuts = plan.cuts;
let effectiveTotal = plan.totalSec;
if (maxDur && Number.isFinite(maxDur) && maxDur > 0 && maxDur < plan.totalSec) {
  effectiveCuts = [];
  for (const c of plan.cuts) {
    if (c.tOnTimeline >= maxDur) break;
    const room = maxDur - c.tOnTimeline;
    effectiveCuts.push({ ...c, durSec: Math.min(c.durSec, room) });
  }
  effectiveTotal = maxDur;
  const dropped = plan.cuts.length - effectiveCuts.length;
  console.log(`  length cap: ${maxDur.toFixed(2)}s — kept ${effectiveCuts.length}/${plan.cuts.length} cuts (dropped ${dropped})`);
}

console.log("  [1/2] concatenating clips with cuts + grade + audio + aspect/fps + edge fades...");
renderClips(clipPaths, effectiveCuts, plan.transitions, effectiveTotal, concatPath, lookFfmpeg, audioOpts, aspect, fps, { fadeFromBlackSec: fadeFromBlack, fadeToBlackSec: fadeToBlack });

console.log("  [2/2] overlaying titles + final encode...");
overlayTitles(concatPath, plan.titles, plan.totalSec, args.out);

console.log(`Wrote ${args.out}`);
