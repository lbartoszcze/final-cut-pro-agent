#!/usr/bin/env node
// FCPXML edit generator for Final Cut Pro.
// Usage:
//   node make-cut.mjs                                       # test-pattern, montage, 16 bars, 140 bpm
//   node make-cut.mjs --mode=clips --clips=./footage         # arrange folder of clips
//   node make-cut.mjs --mode=clips --clips=./footage --style=cinematic --bpm=92 --bars=24
//   node make-cut.mjs --style=jump-cut --bpm=140             # synth test patterns at 140 bpm
// Styles: montage, cinematic, jump-cut, slow-mo. Modes: clips, test-pattern.

import { writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, resolve, extname } from "node:path";
import { reseed, sectionOf, planBarCuts, transitionFrames, planTitles, pickClipIndex } from "./lib/edit.mjs";
import { asset, format, assetClip, gap, transition, title, document, rt } from "./lib/fcpxml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RATE_NUM = 30000, RATE_DEN = 1001, FPS = RATE_NUM / RATE_DEN;
const FRAME_DUR = `${RATE_DEN}/${RATE_NUM}s`;

const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".mkv", ".avi"]);

function parseArgs(argv) {
  const out = { mode: "test-pattern", style: "montage", bpm: "140", bars: "16", clips: "", out: "cut.fcpxml" };
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.+)$/);
    if (m) out[m[1]] = m[2];
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

// Probe a video file's duration in frames at the project rate. Falls back to
// 600 frames (~20s @ 30fps) if ffprobe is missing or the file is malformed.
function probeDurationFrames(path) {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path], { encoding: "utf8" }).trim();
    const sec = parseFloat(out);
    if (!Number.isFinite(sec) || sec <= 0) return 600;
    return Math.max(30, Math.round(sec * FPS));
  } catch {
    return 600;
  }
}

// Synthesize N color-bar test patterns into .work/. Each is 8s @ 30fps so the
// downstream cadence has plenty of head-room when picking sub-clips.
function makeTestPatterns(workDir) {
  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });
  const palette = [
    "color=c=0x1a1a1a", "color=c=0x222831",
    "color=c=0x393e46", "color=c=0xeeeeee",
    "color=c=0xff5722", "color=c=0x00adb5",
  ];
  const out = [];
  for (let i = 0; i < palette.length; i++) {
    const path = join(workDir, `pattern-${i}.mp4`);
    if (!existsSync(path)) {
      const filter = `${palette[i]}:s=1920x1080:r=30000/1001:d=8,drawtext=text='SCENE ${i + 1}':fontcolor=white:fontsize=120:x=(w-text_w)/2:y=(h-text_h)/2`;
      const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", filter, "-c:v", "libx264", "-pix_fmt", "yuv420p", path], { encoding: "utf8" });
      if (r.status !== 0) throw new Error("ffmpeg failed:\n" + (r.stderr || "").slice(-1000));
    }
    out.push(path);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const bpm = parseInt(args.bpm);
const bars = parseInt(args.bars);
if (!Number.isFinite(bpm) || bpm < 30) throw new Error(`bad --bpm: ${args.bpm}`);
if (!Number.isFinite(bars) || bars < 1) throw new Error(`bad --bars: ${args.bars}`);
reseed((bpm * 1000 + bars) >>> 0);

let clipPaths = [];
if (args.mode === "clips") {
  if (!args.clips) throw new Error("--mode=clips requires --clips=<folder>");
  clipPaths = listClipsInFolder(args.clips);
  if (clipPaths.length === 0) throw new Error(`no video files in ${args.clips}`);
} else {
  clipPaths = makeTestPatterns(join(HERE, ".work", "patterns"));
}

const beatFrames = Math.round((60 / bpm) * FPS);
const barFrames = beatFrames * 4;
const totalFrames = bars * barFrames;

const probed = clipPaths.map((p, i) => ({
  id: `r${10 + i}`,
  src: p,
  name: basename(p, extname(p)),
  durFrames: probeDurationFrames(p),
}));

// Build spine: gap intro (no clip until bar 0 ends) is omitted; we drop
// straight into the first cut on bar 0 beat 0.
const spine = [];
let cutGlobalIdx = 0;
let prevSec = null;
let prevEndOffset = 0;

for (let bar = 0; bar < bars; bar++) {
  const cuts = planBarCuts(args.style, bars, bar);
  const sec = sectionOf(bar, bars);
  const sectionChanged = prevSec !== null && prevSec !== sec;

  for (let ci = 0; ci < cuts.length; ci++) {
    const c = cuts[ci];
    const offsetFrames = bar * barFrames + Math.round(c.beatStart * beatFrames);
    let durFrames = Math.max(2, Math.round(c.beatLen * beatFrames));
    // Cap clip duration at probed length so FCP doesn't error on out-of-range.
    const idx = pickClipIndex(args.style, cutGlobalIdx, probed.length);
    const a = probed[idx];
    const startFrames = Math.min(0, Math.max(0, Math.floor((cutGlobalIdx % 4) * 30)));
    durFrames = Math.min(durFrames, a.durFrames - startFrames - 1);
    spine.push(assetClip({
      name: `${a.name} ${cutGlobalIdx + 1}`,
      ref: a.id,
      offsetFrames,
      startFrames,
      durFrames,
      rateNum: RATE_NUM,
      rateDen: RATE_DEN,
    }));
    if (sectionChanged && ci === 0) {
      const tFrames = transitionFrames(args.style, true, FPS);
      if (tFrames > 0) {
        spine.push(transition({ offsetFrames, durFrames: tFrames, rateNum: RATE_NUM, rateDen: RATE_DEN }));
      }
    }
    prevEndOffset = offsetFrames + durFrames;
    cutGlobalIdx++;
  }
  prevSec = sec;
}

// Title overlays: lane 1 above the spine.
const titles = planTitles(bars, args.mode === "clips" ? basename(resolve(args.clips)) : `${args.style.toUpperCase()} CUT`);
for (const t of titles) {
  spine.push(title({
    offsetFrames: t.barIdx * barFrames,
    durFrames: t.holdBars * barFrames,
    rateNum: RATE_NUM,
    rateDen: RATE_DEN,
    text: t.text,
  }));
}

const fmt = format({ id: "r1", name: "FFVideoFormat1080p2997", frameDuration: FRAME_DUR, width: "1920", height: "1080" });
const assetsXml = probed.map((a) => asset({
  id: a.id,
  name: a.name,
  src: a.src,
  durFrames: a.durFrames,
  rateNum: RATE_NUM,
  rateDen: RATE_DEN,
})).join("\n    ");

const xml = document({
  formatNode: fmt,
  eventName: "FCP Agent",
  projectName: `${args.style} ${bars}b @ ${bpm}`,
  sequenceFormat: "r1",
  durFrames: totalFrames,
  rateNum: RATE_NUM,
  rateDen: RATE_DEN,
  assetsXml,
  spineXml: spine.join("\n            "),
});

const outPath = join(HERE, args.out);
writeFileSync(outPath, xml);
console.log(`Wrote ${args.out} (${args.style}, ${args.mode}, ${bars} bars @ ${bpm} bpm, ${probed.length} source clips, ${cutGlobalIdx} cuts, ${titles.length} titles)`);
