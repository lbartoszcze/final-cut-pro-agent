#!/usr/bin/env node
// FCPXML edit generator for Final Cut Pro. Run --help for full flag list.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, resolve, extname } from "node:path";
import { reseed, sectionOf, planBarCuts, transitionFrames, planTitles, pickClipIndex } from "../lib/edit.mjs";
import { asset, format, assetClip, gap, transition, title, document, rt, adjustVolume, marker, parseCustomMarkers, emitCustomMarkers, emitOrphanMarkers } from "../lib/fcpxml.mjs";
import { parseTemplate, applyTemplate, sanitizeInnerXml } from "../lib/render/template.mjs";
import { LOOKS, LOOK_EFFECT_DECL, LUT_EFFECT_DECL, resolveLook, lutFcpFilter } from "../lib/render/grades.mjs";
import { probeLoudness, parseAspect, parseFps, resolvePlatform } from "../lib/render/ffmpeg.mjs";
import { detectTempo, snapTempo } from "../lib/analyze/beats.mjs";
import { analyzeShots } from "../lib/analyze/motion.mjs";
import { rankShots, pickShotForCut, planBrolls, groupMulticam, multicamRewriteOne } from "../lib/analyze/score.mjs";
import { enrichShotsWithFaces } from "../lib/analyze/faces.mjs";
import { listClipsInFolder, probeDurationFrames, makeTestPatterns } from "../lib/source/sources.mjs";
import { mergeStylePack, listStylePacks } from "../lib/styles/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function parseArgs(argv) {
  let sup = {};
  for (const a of argv) { const m = a.match(/^--([^=]+)=(.+)$/); if (m) sup[m[1]] = m[2]; }
  if (argv.includes("--list-styles")) { for (const s of listStylePacks()) console.log(`${s.name.padEnd(22)} ${s.description}`); process.exit(0); }
  if (sup.style && !["montage", "linear"].includes(sup.style)) { sup = mergeStylePack(sup.style, sup); delete sup.style; }
  const p = sup.platform ? resolvePlatform(sup.platform) : null;
  const out = { mode: "test-pattern", style: "montage", bpm: "140", bars: "16", clips: "", out: "cut.fcpxml", template: "", look: "cinematic", lut: "", platform: "", "audio-target": String(p?.audioTarget ?? -16), "audio-fade": "0.05", aspect: p?.aspect ?? "16:9", fps: p?.fps ?? "29.97", "max-duration": p?.maxDuration != null ? String(p.maxDuration) : "", "auto-chapters": "1", markers: "", music: "", "smart-pick": "1", "hook-sec": "3.5", brolls: "1", "match-cuts": "1", faces: "0", "custom-markers": "", ...sup };
  if (out.clips) out.mode = "clips";
  return out;
}

const args = parseArgs(process.argv.slice(2));
let downbeatOffsetSec = 0;
if (args.music) {
  // --music=<path> overrides --bpm with auto-detected tempo + downbeat phase.
  // Result is snapped to the nearest integer (or half-step) so a clean
  // 120-BPM source doesn't drift into 119.57 fractional cadence.
  const t = detectTempo(resolve(args.music));
  args.bpm = String(snapTempo(t.bpm));
  downbeatOffsetSec = t.downbeatOffsetSec;
  console.log(`[music] detected ${t.bpm.toFixed(2)} BPM → snapped to ${args.bpm}, downbeat @ ${downbeatOffsetSec.toFixed(3)}s`);
}
const bpm = parseInt(args.bpm);
const bars = parseInt(args.bars);
if (!Number.isFinite(bpm) || bpm < 30) throw new Error(`bad --bpm: ${args.bpm}`);
if (!Number.isFinite(bars) || bars < 1) throw new Error(`bad --bars: ${args.bars}`);
reseed((bpm * 1000 + bars) >>> 0);

const fps = parseFps(args.fps);
const RATE_NUM = fps.num, RATE_DEN = fps.den, FPS = RATE_NUM / RATE_DEN;
const FRAME_DUR = `${RATE_DEN}/${RATE_NUM}s`;

let clipPaths = [];
if (args.mode === "clips") {
  if (!args.clips) throw new Error("--mode=clips requires --clips=<folder>");
  clipPaths = listClipsInFolder(args.clips);
  if (clipPaths.length === 0) throw new Error(`no video files in ${args.clips}`);
} else {
  clipPaths = makeTestPatterns(join(ROOT, ".work", "patterns"), RATE_NUM, RATE_DEN);
}

const beatFrames = Math.round((60 / bpm) * FPS);
const barFrames = beatFrames * 4;
let totalFrames = bars * barFrames;

// Pre-parse template so we know what effect IDs it uses and can place the
// user's asset IDs above that range. Cadence mode uses default base of r10.
let templateData = null;
let assetIdBase = 10;
let effectsXml = null;
if (args.template) {
  templateData = parseTemplate(resolve(args.template));
  let maxId = 1;
  for (const e of templateData.effects) {
    const m = e.id.match(/^r(\d+)$/);
    if (m) maxId = Math.max(maxId, parseInt(m[1]));
  }
  assetIdBase = maxId + 1;
  effectsXml = templateData.effects.map((e) => "    " + e.raw).join("\n");
}

// --look stacks on top of any template grade; --lut stacks on top of --look.
const look = resolveLook(args.look, clipPaths[0]);
let lookXml = look.fcp;
if (look.fcp) effectsXml = (effectsXml ? effectsXml + "\n    " : "    ") + LOOK_EFFECT_DECL;
if (args.lut) {
  effectsXml = (effectsXml ? effectsXml + "\n    " : "    ") + LUT_EFFECT_DECL;
  lookXml = lookXml + lutFcpFilter(resolve(args.lut));
}

const probed = clipPaths.map((p, i) => ({
  id: `r${assetIdBase + i}`,
  src: p,
  name: basename(p, extname(p)),
  durFrames: probeDurationFrames(p, FPS),
}));

// Per-clip loudness measurement → per-clip dB gain toward target.
// args.audio-target is integrated LUFS (e.g. -16 web, -14 YouTube, -23 EBU R128).
// "off" disables the audio normalization entirely.
const audioTarget = args["audio-target"] === "off" ? null : parseFloat(args["audio-target"]);
const audioFadeSec = parseFloat(args["audio-fade"]);
const perClipGainDB = new Array(probed.length).fill(null);
if (audioTarget !== null && Number.isFinite(audioTarget)) {
  for (let i = 0; i < probed.length; i++) {
    const m = probeLoudness(probed[i].src);
    if (m && Number.isFinite(m.inputI) && m.inputI > -70) {
      perClipGainDB[i] = audioTarget - m.inputI;
    }
  }
}
function audioChildrenFor(srcIdx, durSec) {
  if (audioTarget === null || perClipGainDB[srcIdx] === null) return "";
  return adjustVolume({ amountDB: perClipGainDB[srcIdx], fadeInSec: audioFadeSec, fadeOutSec: audioFadeSec, durSec });
}
let ranked = null;
if (args["smart-pick"] !== "0" && args.mode === "clips" && !args.template) {
  console.log(`[shots] analysing ${probed.length} source clips for motion + scene cuts...`);
  const shotsByClip = probed.map((p) => analyzeShots(p.src, p.durFrames / FPS));
  if (args.faces !== "0") { console.log(`[faces] haarcascade face detection at 5 fps...`); enrichShotsWithFaces(probed.map((p) => p.src), shotsByClip); }
  ranked = rankShots(shotsByClip);
  const total = shotsByClip.reduce((n, s) => n + s.length, 0);
  console.log(`[shots] ${total} shots; hook motion=${ranked?.hook.motionAvg.toFixed(2)} faceFrac=${(ranked?.hook.faceFraction || 0).toFixed(2)}`);
}
const customMarkers = parseCustomMarkers(args["custom-markers"]);
const customMarkersEmitted = new Set();
const sectionCutCounts = { intro: 0, verse: 0, chorus: 0, outro: 0 };
const mcGroups = args.multicam !== "0" ? groupMulticam(probed.map((p) => p.src)) : null;
const mcState = { lastAngle: null };
const HOOK_SEC = parseFloat(args["hook-sec"]) || 3.5;
const matchCutsOn = args["match-cuts"] !== "0";
let hookCutCount = 0;
let prevShot = null;
const autoChapters = args["auto-chapters"] !== "0";
function chapterMarkerFor(label, startFrames) {
  if (!autoChapters) return "";
  return marker({ startSec: startFrames / FPS, value: label.charAt(0).toUpperCase() + label.slice(1), kind: "chapter-marker", rateNum: RATE_NUM, rateDen: RATE_DEN });
}

// --- Template mode: borrow cadence from a reference fcpxml ----------------
const spine = [];
let cutGlobalIdx = 0;
let titlesEmitted = 0;
if (args.template) {
  const tpl = templateData;
  const probedSec = probed.map((p) => p.durFrames / FPS);
  const resolved = applyTemplate(tpl, probedSec);
  totalFrames = Math.max(barFrames, Math.round(tpl.totalSec * FPS));
  for (const r of resolved) {
    const offsetFrames = Math.round(r.offsetSec * FPS);
    const durFrames = Math.max(2, Math.round(r.durSec * FPS));
    if (r.kind === "title") {
      spine.push(title({ offsetFrames, durFrames, rateNum: RATE_NUM, rateDen: RATE_DEN, text: r.text || r.name || "Title" }));
      titlesEmitted++;
      continue;
    }
    if (r.kind === "transition" || r.kind === "gap") continue;
    const a = probed[r.srcIdx];
    const startFrames = Math.max(0, Math.round(r.srcInSec * FPS));
    const safeDur = Math.min(durFrames, Math.max(2, a.durFrames - startFrames - 1));
    // Carry the template clip's filter-video + adjust-* + param children
    // through to the substituted clip — this is what makes the color grade,
    // transform, audio adjustments, etc. apply to the user's footage.
    // Append the user-requested look filter on top so --look stacks.
    // Also stack the per-clip audio normalization (template's adjust-volume
    // is preserved in innerXml; ours is additional gain toward target LUFS).
    const children = sanitizeInnerXml(r.innerXml) + audioChildrenFor(r.srcIdx, safeDur / FPS) + lookXml;
    spine.push(assetClip({
      name: `${a.name} ${cutGlobalIdx + 1}`,
      ref: a.id,
      offsetFrames,
      startFrames,
      durFrames: safeDur,
      rateNum: RATE_NUM,
      rateDen: RATE_DEN,
      children,
    }));
    cutGlobalIdx++;
  }
}

// --- Cadence mode: procedural cut grid driven by --bpm --bars --style ------
let prevSec = null;
let prevEndOffset = 0;

if (!args.template) for (let bar = 0; bar < bars; bar++) {
  const cuts = planBarCuts(args.style, bars, bar);
  const sec = sectionOf(bar, bars);
  const sectionChanged = prevSec !== null && prevSec !== sec;

  for (let ci = 0; ci < cuts.length; ci++) {
    const c = cuts[ci];
    const offsetFrames = bar * barFrames + Math.round(c.beatStart * beatFrames);
    let durFrames = Math.max(2, Math.round(c.beatLen * beatFrames));
    // Smart pick: section-aware shot, anchored to shot in-point.
    // Plain pick: round-robin clip with offset jitter (back-compat path).
    let idx, startFrames;
    if (ranked) {
      const offsetSec = offsetFrames / FPS;
      const hookIdx = offsetSec < HOOK_SEC ? hookCutCount++ : -1;
      const shot = pickShotForCut(ranked, sec, sectionCutCounts[sec] || 0, hookIdx, matchCutsOn ? prevShot : null);
      idx = shot.clipIdx;
      prevShot = shot;
      const shotStartF = Math.round(shot.start * FPS);
      const shotEndF = Math.round(shot.end * FPS);
      const shotLen = Math.max(2, shotEndF - shotStartF - 1);
      startFrames = shotStartF;
      durFrames = Math.min(durFrames, shotLen);
      if (hookIdx < 0) sectionCutCounts[sec] = (sectionCutCounts[sec] || 0) + 1;
    } else {
      idx = pickClipIndex(args.style, cutGlobalIdx, probed.length);
      const a0 = probed[idx];
      const headroom = Math.max(0, a0.durFrames - durFrames - 1);
      startFrames = headroom === 0 ? 0 : Math.floor((cutGlobalIdx * 13) % headroom);
    }
    if (mcGroups) idx = multicamRewriteOne(idx, probed.map((p) => p.src), mcGroups, mcState);
    const a = probed[idx];
    durFrames = Math.min(durFrames, a.durFrames - startFrames - 1);
    const newChapter = ((bar === 0 && ci === 0) || (sectionChanged && ci === 0)) ? chapterMarkerFor(sec, startFrames) : "";
    const cmXml = emitCustomMarkers(customMarkers, customMarkersEmitted, offsetFrames, startFrames, durFrames, RATE_NUM, RATE_DEN, FPS);
    const kws = [sec]; if (ranked && offsetFrames / FPS < HOOK_SEC) kws.push("hook");
    spine.push(assetClip({ name: `${a.name} ${cutGlobalIdx + 1}`, ref: a.id, offsetFrames, startFrames, durFrames, rateNum: RATE_NUM, rateDen: RATE_DEN, role: "dialogue", keywords: kws, children: audioChildrenFor(idx, durFrames / FPS) + lookXml + newChapter + cmXml }));
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

spine.push(emitOrphanMarkers(customMarkers, customMarkersEmitted, RATE_NUM, RATE_DEN, FPS));
let brollCount = 0;
if (ranked && args["brolls"] !== "0" && !args.template) {
  for (const b of planBrolls(ranked, sectionOf, bars, barFrames / FPS)) {
    const a = probed[b.clipIdx];
    spine.push(assetClip({ name: `${a.name} broll ${++brollCount}`, ref: a.id, offsetFrames: Math.round(b.tOnTimeline * FPS), startFrames: Math.round(b.srcInSec * FPS), durFrames: Math.max(2, Math.round(b.durSec * FPS)), rateNum: RATE_NUM, rateDen: RATE_DEN, lane: "1", role: "video", children: lookXml }));
  }
}

// Title overlays for cadence mode (template mode emits its own titles inline).
let titles = [];
if (!args.template) {
  titles = planTitles(bars, args.mode === "clips" ? basename(resolve(args.clips)) : `${args.style.toUpperCase()} CUT`);
  for (const t of titles) {
    spine.push(title({
      offsetFrames: t.barIdx * barFrames,
      durFrames: t.holdBars * barFrames,
      rateNum: RATE_NUM,
      rateDen: RATE_DEN,
      text: t.text,
    }));
  }
}

const aspect = parseAspect(args.aspect);
const fmtName = aspect.w === 1920 && aspect.h === 1080
  ? "FFVideoFormat1080p2997"
  : `FFVideoFormat${aspect.h}p2997`;
const fmt = format({ id: "r1", name: fmtName, frameDuration: FRAME_DUR, width: String(aspect.w), height: String(aspect.h) });
const assetsXml = probed.map((a) => asset({
  id: a.id,
  name: a.name,
  src: a.src,
  durFrames: a.durFrames,
  rateNum: RATE_NUM,
  rateDen: RATE_DEN,
})).join("\n    ");

const projectName = args.template
  ? `template:${basename(args.template, ".fcpxml")}`
  : `${args.style} ${bars}b @ ${bpm}`;

const xml = document({
  formatNode: fmt,
  eventName: "FCP Agent",
  projectName,
  sequenceFormat: "r1",
  durFrames: totalFrames,
  rateNum: RATE_NUM,
  rateDen: RATE_DEN,
  assetsXml,
  spineXml: spine.join("\n            "),
  effectsXml,
});

const outPath = resolve(ROOT, args.out);
writeFileSync(outPath, xml);
const titleCount = args.template ? titlesEmitted : titles.length;
const summary = args.template
  ? `template ${basename(args.template)}, ${probed.length} source clips, ${cutGlobalIdx} cuts, ${titleCount} titles`
  : `${args.style}, ${args.mode}, ${bars} bars @ ${bpm} bpm, ${probed.length} source clips, ${cutGlobalIdx} cuts, ${titleCount} titles`;
console.log(`Wrote ${args.out} (${summary})`);
