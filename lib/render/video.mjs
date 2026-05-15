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
import { ffmpeg, ffprobeDurationSec, ffprobeHasAudio, renderClips, overlayTitles, renderColor, probeLoudness, parseAspect, parseFps, resolvePlatform, muxMusic, overlayBrolls } from "./ffmpeg.mjs";
import { parseTemplate, applyTemplate } from "./template.mjs";
import { resolveLook, lutFfmpegFilter, vignetteFilter, grainFilter, sharpenFilter } from "./grades.mjs";
import { detectTempo, snapTempo, detectAudioOnsets } from "../analyze/beats.mjs";
import { analyzeShots } from "../analyze/motion.mjs";
import { rankShots } from "../analyze/score.mjs";
import { transcribeVideo } from "../analyze/captions.mjs";
import { stabilizeClips } from "../source/preprocess.mjs";
import { enrichShotsWithFaces } from "../analyze/faces.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".mkv", ".avi"]);

function parseArgs(argv) {
  const defaults = { mode: "test-pattern", style: "montage", bpm: "140", bars: "16", clips: "", out: join(ROOT, "cut-rendered.mp4"), template: "", look: "cinematic", "audio-target": "-16", "audio-fade": "0.05", aspect: "16:9", fps: "29.97", "fade-from-black": "0", "fade-to-black": "0", "max-duration": "", lut: "", platform: "", vignette: "0", grain: "0", sharpen: "0", music: "", "music-mix": "1", "smart-pick": "1", captions: "off", "caption-model": "small.en", "caption-lang": "en", stabilize: "0", speed: "1", "hook-sec": "3.5", brolls: "0", "match-cuts": "1", jcut: "0", lcut: "0", faces: "0", "lower-third": "", "end-card": "", logo: "", "logo-pos": "tr", "logo-scale": "0.1", denoise: "0", limit: "1", highpass: "0", chromakey: "", pip: "", "pip-pos": "br", "pip-scale": "0.25", codec: "h264", lumakey: "", "eq-bass": "0", "eq-mid": "0", "eq-treble": "0", sfx: "", "sfx-gain": "0", establishing: "0", "snap-to-audio": "" };
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
let musicDownbeatSec = 0;
if (args.music) {
  const t = detectTempo(resolve(args.music));
  args.bpm = String(snapTempo(t.bpm));
  musicDownbeatSec = t.downbeatOffsetSec;
  console.log(`[music] detected ${t.bpm.toFixed(2)} BPM → snapped to ${args.bpm}, downbeat @ ${musicDownbeatSec.toFixed(3)}s`);
}
const bpm = parseInt(args.bpm);
const bars = parseInt(args.bars);
if (!Number.isFinite(bpm) || bpm < 30) throw new Error(`bad --bpm: ${args.bpm}`);
if (!Number.isFinite(bars) || bars < 1) throw new Error(`bad --bars: ${args.bars}`);

let clipPaths = args.mode === "clips"
  ? (args.clips ? listClipsInFolder(args.clips) : (() => { throw new Error("--mode=clips requires --clips"); })())
  : makeTestPatterns(join(ROOT, ".work", "patterns"));

if (clipPaths.length === 0) throw new Error("no source clips");

if (args.stabilize !== "0" && args.mode === "clips") {
  console.log(`[stabilize] running 2-pass vidstab on ${clipPaths.length} clips (cached under .work/stab)...`);
  clipPaths = stabilizeClips(clipPaths, join(ROOT, ".work"), { shakiness: 6, smoothing: 15, zoom: 5 });
}

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
  const smartOn = args["smart-pick"] !== "0" && args.mode === "clips" && !args.template;
  const ranked = smartOn ? (() => {
    console.log(`[shots] analysing ${clipPaths.length} source clips for motion + scene cuts...`);
    const sb = clipPaths.map((p, i) => analyzeShots(p, clipDurations[i] || 0));
    if (args.faces !== "0") { console.log(`[faces] haarcascade face detection at 5 fps...`); enrichShotsWithFaces(clipPaths, sb); }
    const r = rankShots(sb);
    if (r) console.log(`[shots] hook motion=${r.hook.motionAvg.toFixed(2)} faceFrac=${(r.hook.faceFraction || 0).toFixed(2)}`);
    return r;
  })() : null;
  const estRaw = Number.parseFloat(args.establishing);
  const onsetSrc = args["snap-to-audio"] === "1" ? (args.music || clipPaths[0]) : args["snap-to-audio"];
  const audioOnsets = onsetSrc ? (console.log(`[snap] detecting audio onsets in ${onsetSrc}...`), detectAudioOnsets(resolve(onsetSrc), 0.85)) : null;
  if (audioOnsets) console.log(`[snap] ${audioOnsets.length} onsets`);
  plan = build(args.style, bars, bpm, { clipDurations, projectName, seed: (bpm * 1000 + bars) >>> 0, ranked, hookSec: parseFloat(args["hook-sec"]) || 3.5, brolls: args.brolls !== "0" && !!ranked, matchCuts: args["match-cuts"] !== "0", chromaKey: args.chromakey || null, lumaKey: args.lumakey || null, establishingSec: Number.isFinite(estRaw) && estRaw > 0 ? estRaw : 0, audioOnsets, audioSnapTolerance: 0.15 });
  console.log(`Rendering ${bars} bars of ${args.style} at ${bpm} BPM (${plan.totalSec.toFixed(1)}s) from ${clipPaths.length} clips...`);
}
console.log(`  cuts=${plan.cuts.length} transitions=${plan.transitions.length} titles=${plan.titles.length}`);

const tmpDir = join(ROOT, ".work");
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
const concatPath = join(tmpDir, "concat.mp4");

const look = resolveLook(args.look, clipPaths[0]);
const extraChains = [
  look.ffmpeg,
  args.lut ? lutFfmpegFilter(resolve(args.lut)) : "",
  vignetteFilter(args.vignette),
  grainFilter(args.grain),
  sharpenFilter(args.sharpen),
].filter(Boolean);
const lookFfmpeg = extraChains.join(",");
if (extraChains.length) console.log(`  per-clip filter chain: ${extraChains.join(" -> ")}`);

const audioTarget = args["audio-target"] === "off" ? null : parseFloat(args["audio-target"]);
const audioFadeSec = parseFloat(args["audio-fade"]);
let audioOpts = null;
if (audioTarget !== null && Number.isFinite(audioTarget)) {
  console.log(`  measuring per-clip loudness (target ${audioTarget} LUFS)...`);
  const perClipMeasured = clipPaths.map((p) => probeLoudness(p));
  const hpRaw = Number.parseFloat(args.highpass);
  const eqB = Number.parseFloat(args["eq-bass"]), eqM = Number.parseFloat(args["eq-mid"]), eqT = Number.parseFloat(args["eq-treble"]);
  const extra = {
    denoise: args.denoise !== "0",
    limit: args.limit !== "0",
    highpass: Number.isFinite(hpRaw) && hpRaw > 0 ? hpRaw : 0,
    eqBass: Number.isFinite(eqB) && eqB !== 0 ? eqB : 0,
    eqMid: Number.isFinite(eqM) && eqM !== 0 ? eqM : 0,
    eqTreble: Number.isFinite(eqT) && eqT !== 0 ? eqT : 0,
  };
  audioOpts = { targetLUFS: audioTarget, fadeInSec: audioFadeSec, fadeOutSec: audioFadeSec, perClipMeasured, extra };
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
const jcutSec = Number.parseFloat(args.jcut), lcutSec = Number.parseFloat(args.lcut);
if (!Number.isFinite(jcutSec) || jcutSec < 0) throw new Error(`bad --jcut: ${args.jcut}`);
if (!Number.isFinite(lcutSec) || lcutSec < 0) throw new Error(`bad --lcut: ${args.lcut}`);
renderClips(clipPaths, effectiveCuts, plan.transitions, effectiveTotal, concatPath, lookFfmpeg, audioOpts, aspect, fps, { fadeFromBlackSec: fadeFromBlack, fadeToBlackSec: fadeToBlack, jcutSec, lcutSec });

if (plan.brolls && plan.brolls.length > 0) {
  console.log(`  [1.5] overlaying ${plan.brolls.length} B-roll cutaways...`);
  const brollSpecs = plan.brolls.map((b) => ({ ...b, srcPath: clipPaths[b.srcIdx] }));
  const brollPath = join(tmpDir, "broll.mp4");
  overlayBrolls(concatPath, brollSpecs, brollPath, aspect);
  // Re-point downstream stages to the brolled output by rewriting concatPath.
  ffmpeg(["-i", brollPath, "-c", "copy", concatPath]);
}

const capOn = args.captions !== "off";
const speed = parseFloat(args.speed) || 1;
if (!(speed > 0)) throw new Error("--speed must be > 0");
const logoOn = !!args.logo;
const pipOn = !!args.pip;
const sfxOn = !!args.sfx && plan.transitions && plan.transitions.length > 0;
const codecSpec = args.codec;
const codecMap = { h264: { v: "libx264" }, h265: { v: "libx265" }, prores: { v: "prores_ks", extra: ["-profile:v", "3"] } };
if (!codecMap[codecSpec]) throw new Error(`bad --codec: ${codecSpec} (expect h264 / h265 / prores)`);
const transcodeOn = codecSpec !== "h264";
const stages = ["titles", capOn ? "captions" : null, pipOn ? "pip" : null, logoOn ? "logo" : null, sfxOn ? "sfx" : null, speed !== 1 ? "retime" : null, args.music ? "music" : null, transcodeOn ? "codec" : null].filter(Boolean);
const lastStage = stages[stages.length - 1];
const tmpOut = (name) => join(tmpDir, `${name}.mp4`);
const pathFor = (name) => name === lastStage ? args.out : tmpOut(name);

if (args["lower-third"]) plan.titles.push({ tOnTimeline: 2, durSec: 4, text: args["lower-third"], position: "lower-third" });
if (args["end-card"]) plan.titles.push({ tOnTimeline: Math.max(0, plan.totalSec - 3), durSec: 3, text: args["end-card"], position: "end-card" });
console.log(`  [2] overlaying titles + final encode...`);
overlayTitles(concatPath, plan.titles, plan.totalSec, pathFor("titles"));
let acc = pathFor("titles");

if (capOn) {
  console.log(`  [3] transcribing with whisper (model=${args["caption-model"]}, lang=${args["caption-lang"]})...`);
  const baseOut = args.out.replace(/\.[^.]+$/, "");
  const segs = transcribeVideo(concatPath, tmpDir, { model: args["caption-model"], language: args["caption-lang"], srtOut: `${baseOut}.srt`, vttOut: `${baseOut}.vtt`, ittOut: `${baseOut}.itt` });
  console.log(`    ${segs.length} caption segments → ${baseOut}.srt / .vtt / .itt`);
  const srtArg = `${baseOut}.srt`.replace(/'/g, "\\'").replace(/:/g, "\\:");
  ffmpeg(["-i", acc, "-vf", `subtitles=${srtArg}:force_style='Fontsize=22,Outline=2,BorderStyle=1,Alignment=2,MarginV=80'`, "-c:a", "copy", "-c:v", "libx264", "-pix_fmt", "yuv420p", pathFor("captions")]);
  acc = pathFor("captions");
}

if (pipOn) {
  const ps = Number.parseFloat(args["pip-scale"]);
  if (!Number.isFinite(ps) || ps <= 0 || ps > 1) throw new Error(`bad --pip-scale: ${args["pip-scale"]}`);
  const pw = Math.round(aspect.w * ps), m = 30;
  const xyMap = { tl: `${m}:${m}`, tr: `W-w-${m}:${m}`, bl: `${m}:H-h-${m}`, br: `W-w-${m}:H-h-${m}` };
  const xy = xyMap[args["pip-pos"]];
  if (!xy) throw new Error(`bad --pip-pos: ${args["pip-pos"]} (expect tl/tr/bl/br)`);
  console.log(`  [3b] overlaying PiP (${args["pip-pos"]}, scale=${ps})...`);
  ffmpeg(["-i", acc, "-i", resolve(args.pip), "-filter_complex", `[1:v]scale=${pw}:-2[pip];[0:v][pip]overlay=${xy}:shortest=0[v]`, "-map", "[v]", "-map", "0:a?", "-c:a", "copy", "-c:v", "libx264", "-pix_fmt", "yuv420p", pathFor("pip")]);
  acc = pathFor("pip");
}

if (logoOn) {
  const scale = Number.parseFloat(args["logo-scale"]);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`bad --logo-scale: ${args["logo-scale"]}`);
  const px = Math.max(40, Math.round(aspect.w * scale));
  const m = 30;
  const xyMap = { tl: `${m}:${m}`, tr: `W-w-${m}:${m}`, bl: `${m}:H-h-${m}`, br: `W-w-${m}:H-h-${m}` };
  const xy = xyMap[args["logo-pos"]];
  if (!xy) throw new Error(`bad --logo-pos: ${args["logo-pos"]} (expect tl/tr/bl/br)`);
  console.log(`  [3a] overlaying logo (${args["logo-pos"]}, scale=${scale})...`);
  ffmpeg(["-i", acc, "-i", resolve(args.logo), "-filter_complex", `[1:v]scale=${px}:-1[lg];[0:v][lg]overlay=${xy}[v]`, "-map", "[v]", "-map", "0:a?", "-c:a", "copy", "-c:v", "libx264", "-pix_fmt", "yuv420p", pathFor("logo")]);
  acc = pathFor("logo");
}

if (sfxOn) {
  const ts = plan.transitions.map((t) => t.tOnTimeline);
  const n = ts.length;
  const sg = Number.parseFloat(args["sfx-gain"]);
  const gain = Number.isFinite(sg) ? sg : 0;
  const splits = `[1:a]asplit=${n}${ts.map((_, i) => `[s${i}]`).join("")}`;
  const delays = ts.map((t, i) => `[s${i}]adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)},volume=${Math.pow(10, gain / 20).toFixed(3)}[d${i}]`).join(";");
  const mixLabels = `[0:a]${ts.map((_, i) => `[d${i}]`).join("")}`;
  const chain = `${splits};${delays};${mixLabels}amix=inputs=${n + 1}:duration=first:dropout_transition=0:normalize=0[outa]`;
  console.log(`  [4a] mixing ${n} SFX hits at section boundaries...`);
  ffmpeg(["-i", acc, "-i", resolve(args.sfx), "-filter_complex", chain, "-map", "0:v", "-map", "[outa]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", pathFor("sfx")]);
  acc = pathFor("sfx");
}

if (speed !== 1) {
  console.log(`  [4] retiming output at ${speed}x...`);
  const hasAudio = ffprobeHasAudio(acc);
  const tempo = Math.min(2, Math.max(0.5, speed));
  const fc = hasAudio ? `[0:v]setpts=PTS/${speed}[v];[0:a]atempo=${tempo}[a]` : `[0:v]setpts=PTS/${speed}[v]`;
  const maps = hasAudio ? ["-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "192k"] : ["-map", "[v]"];
  ffmpeg(["-i", acc, "-filter_complex", fc, ...maps, "-c:v", "libx264", "-pix_fmt", "yuv420p", pathFor("retime")]);
  acc = pathFor("retime");
}

if (args.music) {
  const mix = args["music-mix"] !== "0";
  console.log(`  [5] muxing music (${mix ? "blend (ducked)" : "replace"}, downbeat shift ${musicDownbeatSec.toFixed(3)}s)...`);
  muxMusic(acc, resolve(args.music), musicDownbeatSec, mix, 0.7, pathFor("music"));
  acc = pathFor("music");
}

if (transcodeOn) {
  console.log(`  [6] re-encoding as ${codecSpec}...`);
  const cm = codecMap[codecSpec];
  ffmpeg(["-i", acc, "-c:v", cm.v, ...(cm.extra || []), "-c:a", "copy", pathFor("codec")]);
}

console.log(`Wrote ${args.out}`);
