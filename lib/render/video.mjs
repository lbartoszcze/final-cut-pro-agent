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
import { ffmpeg, ffprobeDurationSec, renderClips, overlayTitles, renderColor, probeLoudness, parseAspect, parseFps, overlayBrolls } from "./ffmpeg.mjs";
import { parseTemplate, applyTemplate } from "./template.mjs";
import { resolveLook, lutFfmpegFilter, vignetteFilter, grainFilter, sharpenFilter } from "./grades.mjs";
import { detectTempo, snapTempo, detectAudioOnsets, autoPickMusic } from "../analyze/beats.mjs";
import { analyzeShots } from "../analyze/motion.mjs";
import { rankShots } from "../analyze/score.mjs";
import { transcribeVideo } from "../analyze/captions.mjs";
import { stabilizeClips } from "../source/preprocess.mjs";
import { enrichShotsWithFaces } from "../analyze/faces.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".mkv", ".avi"]);

import { parseArgs } from "../cli/render_args.mjs";
import { overlayPip, splitScreen } from "../cli/overlays.mjs";
import { stageLogo, stageFreeze, stageVO, stageSFX, stageRetime, stageMusic, stageCodec, stageColorspace, stageHDR, stageRamp, stageSurround, CODEC_MAP } from "../cli/post.mjs";

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

const args = parseArgs(process.argv.slice(2), ROOT);
let musicDownbeatSec = 0;
if (!args.music && args["music-folder"]) {
  // Auto-pick the music track whose natural duration at its detected BPM is
  // closest to the user's bars × 4 / BPM target. Requires a --bars value.
  const bpmHint = parseInt(args.bpm) || 140;
  const barsHint = parseInt(args.bars) || 16;
  const targetSec = (60 / bpmHint) * 4 * barsHint;
  console.log(`[music] scanning ${args["music-folder"]} for ~${targetSec.toFixed(1)}s tracks...`);
  const pick = autoPickMusic(resolve(args["music-folder"]), targetSec, barsHint);
  if (!pick) throw new Error(`no usable music tracks in ${args["music-folder"]}`);
  args.music = pick.path;
  console.log(`[music] picked ${pick.path} (${pick.bpm.toFixed(1)} BPM, ${pick.durationSec.toFixed(1)}s natural)`);
}
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
  const lfRaw = Number.parseFloat(args["lens-flare"]);
  plan = build(args.style, bars, bpm, { clipDurations, projectName, seed: (bpm * 1000 + bars) >>> 0, ranked, hookSec: parseFloat(args["hook-sec"]) || 3.5, brolls: args.brolls !== "0" && !!ranked, matchCuts: args["match-cuts"] !== "0", chromaKey: args.chromakey || null, lumaKey: args.lumakey || null, establishingSec: Number.isFinite(estRaw) && estRaw > 0 ? estRaw : 0, audioOnsets, audioSnapTolerance: 0.15, transform: args.transform || null, mask: args.mask || null, multicam: args.multicam !== "0", clipPaths, lensFlare: Number.isFinite(lfRaw) ? lfRaw : 0, lensCorrect: args["lens-correct"] || null, crop: args.crop || null, transition: args.transition || "fade" });
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
    multibandComp: args["multiband-comp"] !== "0",
    mcompandSpec: args["mcompand-spec"] || "",
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
const VALID_TRANS = new Set(["fade", "wipeleft", "wiperight", "wipeup", "wipedown", "slideleft", "slideright", "slideup", "slidedown", "circleopen", "circleclose", "fadeblack", "fadewhite", "dissolve", "pixelize", "radial"]);
if (!VALID_TRANS.has(args.transition)) throw new Error(`bad --transition: ${args.transition}`);
renderClips(clipPaths, effectiveCuts, plan.transitions, effectiveTotal, concatPath, lookFfmpeg, audioOpts, aspect, fps, { fadeFromBlackSec: fadeFromBlack, fadeToBlackSec: fadeToBlack, jcutSec, lcutSec, transition: args.transition });

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
// Voice-over: --vo-record=<sec> records the default mic; --vo=<path> mixes
// a pre-recorded VO. --vo-at sets the timeline offset.
let voPath = args.vo ? resolve(args.vo) : null;
const voRecSec = Number.parseFloat(args["vo-record"]);
if (Number.isFinite(voRecSec) && voRecSec > 0) {
  voPath = join(tmpDir, "vo.wav");
  console.log(`[vo] recording ${voRecSec}s from default mic → ${voPath}`);
  ffmpeg(["-f", "avfoundation", "-i", ":0", "-t", voRecSec.toFixed(3), "-ar", "48000", "-ac", "1", voPath]);
}
const voAt = Number.parseFloat(args["vo-at"]);
const voOn = !!voPath;
if (!CODEC_MAP[codecSpec]) throw new Error(`bad --codec: ${codecSpec} (expect h264 / h265 / prores)`);
const transcodeOn = codecSpec !== "h264";
const stages = ["titles", capOn ? "captions" : null, pipOn ? "pip" : null, logoOn ? "logo" : null, sfxOn ? "sfx" : null, args.freeze ? "freeze" : null, voOn ? "vo" : null, speed !== 1 ? "retime" : null, args.ramp ? "ramp" : null, args.music ? "music" : null, args.colorspace ? "cs" : null, transcodeOn ? "codec" : null, args.hdr ? "hdr" : null, args.surround ? "surround" : null].filter(Boolean);
const lastStage = stages[stages.length - 1];
const tmpOut = (name) => join(tmpDir, `${name}.mp4`);
const pathFor = (name) => name === lastStage ? args.out : tmpOut(name);

if (args["section-titles"] === "0") plan.titles = [];
if (args["lower-third"]) plan.titles.push({ tOnTimeline: 2, durSec: 4, text: args["lower-third"], position: "lower-third" });
if (args["end-card"]) plan.titles.push({ tOnTimeline: Math.max(0, plan.totalSec - 3), durSec: 3, text: args["end-card"], position: "end-card" });
console.log(`  [2] overlaying titles + final encode...`);
overlayTitles(concatPath, plan.titles, plan.totalSec, pathFor("titles"), aspect, args.font ? resolve(args.font) : null);
let acc = pathFor("titles");

if (capOn) {
  console.log(`  [3] transcribing with whisper (model=${args["caption-model"]}, lang=${args["caption-lang"]})...`);
  const baseOut = args.out.replace(/\.[^.]+$/, "");
  const segs = transcribeVideo(concatPath, tmpDir, { model: args["caption-model"], language: args["caption-lang"], srtOut: `${baseOut}.srt`, vttOut: `${baseOut}.vtt`, ittOut: `${baseOut}.itt`, speakerLabels: args["speaker-labels"] !== "0" ? args["speaker-labels"] : null });
  console.log(`    ${segs.length} caption segments → ${baseOut}.srt / .vtt / .itt`);
  const srtArg = `${baseOut}.srt`.replace(/'/g, "\\'").replace(/:/g, "\\:");
  ffmpeg(["-i", acc, "-vf", `subtitles=${srtArg}:force_style='Fontsize=22,Outline=2,BorderStyle=1,Alignment=2,MarginV=80'`, "-c:a", "copy", "-c:v", "libx264", "-pix_fmt", "yuv420p", pathFor("captions")]);
  acc = pathFor("captions");
}

if (pipOn) {
  console.log(`  [3b] overlaying PiP (${args["pip-pos"]}, scale=${args["pip-scale"]}${args["pip-blend"] ? `, blend=${args["pip-blend"]}` : ""})...`);
  overlayPip(acc, args, aspect, pathFor("pip"));
  acc = pathFor("pip");
}

if (args.split) {
  console.log(`  [3c] split-screen (${args.split}) over ${clipPaths.length} sources`);
  const splitPath = join(tmpDir, "split.mp4");
  splitScreen(clipPaths, aspect, plan.totalSec, args.split, splitPath);
  acc = splitPath;
}
if (logoOn) { console.log(`  [3a] logo (${args["logo-pos"]}, scale=${args["logo-scale"]})`); stageLogo(acc, args, aspect, pathFor("logo")); acc = pathFor("logo"); }
if (sfxOn) { console.log(`  [4a] ${plan.transitions.length} SFX hits at section boundaries`); stageSFX(acc, args, plan.transitions, pathFor("sfx")); acc = pathFor("sfx"); }
if (args.freeze) { console.log(`  [4c] freeze-frame holds: ${args.freeze}`); stageFreeze(acc, args, pathFor("freeze")); acc = pathFor("freeze"); }
if (voOn) { console.log(`  [4b] voice-over (${voPath} @ ${(voAt || 0).toFixed(3)}s)`); stageVO(acc, voPath, voAt, pathFor("vo")); acc = pathFor("vo"); }
if (speed !== 1) { console.log(`  [4] retime ${speed}x`); stageRetime(acc, speed, pathFor("retime")); acc = pathFor("retime"); }
if (args.ramp) { console.log(`  [4d] speed ramp ${args.ramp}`); stageRamp(acc, args.ramp, pathFor("ramp")); acc = pathFor("ramp"); }
if (args.music) { console.log(`  [5] music (${args["music-mix"] !== "0" ? "blend (ducked)" : "replace"}, downbeat ${musicDownbeatSec.toFixed(3)}s)`); stageMusic(acc, args, resolve(args.music), musicDownbeatSec, pathFor("music")); acc = pathFor("music"); }
if (args.colorspace) { console.log(`  [6] color-space → ${args.colorspace}`); stageColorspace(acc, args.colorspace, pathFor("cs")); acc = pathFor("cs"); }
if (transcodeOn) { console.log(`  [7] codec → ${codecSpec}${args.bitrate ? ` @ ${args.bitrate}` : ""}`); stageCodec(acc, codecSpec, pathFor("codec"), args.bitrate); acc = pathFor("codec"); }
if (args.hdr) { console.log(`  [8] HDR ${args.hdr}`); stageHDR(acc, args.hdr, pathFor("hdr")); acc = pathFor("hdr"); }
if (args.surround) { console.log(`  [9] surround ${args.surround}`); stageSurround(acc, args.surround, pathFor("surround")); }

// Sidecar build.json captures every arg used so re-renders are reproducible.
const baseOutNoExt = args.out.replace(/\.[^.]+$/, "");
const buildJson = { version: args.version || null, out: args.out, args, ts: new Date().toISOString() };
try { (await import("node:fs")).writeFileSync(`${baseOutNoExt}.build.json`, JSON.stringify(buildJson, null, 2)); } catch (_) {}
console.log(`Wrote ${args.out}${args.version ? ` (${args.version})` : ""}`);
