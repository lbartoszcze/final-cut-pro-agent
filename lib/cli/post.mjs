// Post-pipeline stages extracted from lib/render/video.mjs so the orchestrator
// stays under the 300-line cap. Each function takes the current accumulator
// path + args + a `pathFor` allocator and returns the new accumulator path.

import { resolve } from "node:path";
import { ffmpeg, ffprobeHasAudio, muxMusic } from "../render/ffmpeg.mjs";

const CODEC_MAP = { h264: { v: "libx264" }, h265: { v: "libx265" }, prores: { v: "prores_ks", extra: ["-profile:v", "3"] } };
const CS_MAP = { rec709: "bt709", rec2020: "bt2020nc", srgb: "bt709" };

export function stageLogo(acc, args, aspect, outPath) {
  const scale = Number.parseFloat(args["logo-scale"]);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`bad --logo-scale: ${args["logo-scale"]}`);
  const px = Math.max(40, Math.round(aspect.w * scale)), m = 30;
  const xyMap = { tl: `${m}:${m}`, tr: `W-w-${m}:${m}`, bl: `${m}:H-h-${m}`, br: `W-w-${m}:H-h-${m}` };
  const xy = xyMap[args["logo-pos"]];
  if (!xy) throw new Error(`bad --logo-pos: ${args["logo-pos"]} (expect tl/tr/bl/br)`);
  ffmpeg(["-i", acc, "-i", resolve(args.logo), "-filter_complex", `[1:v]scale=${px}:-1[lg];[0:v][lg]overlay=${xy}[v]`, "-map", "[v]", "-map", "0:a?", "-c:a", "copy", "-c:v", "libx264", "-pix_fmt", "yuv420p", outPath]);
}

// Freeze frame at time t for duration d via trim → still-frame loop → trim.
// Single freeze only (multi-freeze can be added by chaining, but the trim
// arithmetic gets hairy; in practice one dramatic hold is what people use).
export function stageFreeze(acc, args, outPath) {
  const fs = args.freeze.split(",").map((s) => { const [t, d] = s.split(":"); return { t: parseFloat(t), d: parseFloat(d) }; }).filter((f) => Number.isFinite(f.t) && Number.isFinite(f.d) && f.d > 0);
  if (fs.length === 0) throw new Error(`bad --freeze: ${args.freeze}`);
  const f = fs[0];
  const t = f.t.toFixed(3), d = f.d.toFixed(3);
  const loops = Math.max(1, Math.round(f.d * 30));
  const chain = `[0:v]trim=0:${t},setpts=PTS-STARTPTS[a];[0:v]trim=${t}:${(f.t + 1 / 30).toFixed(3)},setpts=PTS-STARTPTS,loop=loop=${loops}:size=1:start=0,setpts=N/30/TB[b];[0:v]trim=${t},setpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=1:a=0[v]`;
  ffmpeg(["-i", acc, "-filter_complex", chain, "-map", "[v]", "-map", "0:a?", "-c:a", "copy", "-c:v", "libx264", "-pix_fmt", "yuv420p", outPath]);
}

export function stageVO(acc, voPath, voAtSec, outPath) {
  const delayMs = Math.max(0, Math.round((Number.isFinite(voAtSec) ? voAtSec : 0) * 1000));
  const chain = `[1:a]adelay=${delayMs}|${delayMs},aresample=48000[v];[0:a][v]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[outa]`;
  ffmpeg(["-i", acc, "-i", voPath, "-filter_complex", chain, "-map", "0:v", "-map", "[outa]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", outPath]);
}

export function stageSFX(acc, args, transitions, outPath) {
  const ts = transitions.map((t) => t.tOnTimeline);
  const n = ts.length;
  const sg = Number.parseFloat(args["sfx-gain"]);
  const gain = Number.isFinite(sg) ? sg : 0;
  const splits = `[1:a]asplit=${n}${ts.map((_, i) => `[s${i}]`).join("")}`;
  const delays = ts.map((t, i) => `[s${i}]adelay=${Math.round(t * 1000)}|${Math.round(t * 1000)},volume=${Math.pow(10, gain / 20).toFixed(3)}[d${i}]`).join(";");
  const mixLabels = `[0:a]${ts.map((_, i) => `[d${i}]`).join("")}`;
  const chain = `${splits};${delays};${mixLabels}amix=inputs=${n + 1}:duration=first:dropout_transition=0:normalize=0[outa]`;
  ffmpeg(["-i", acc, "-i", resolve(args.sfx), "-filter_complex", chain, "-map", "0:v", "-map", "[outa]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", outPath]);
}

export function stageRetime(acc, speed, outPath) {
  const hasAudio = ffprobeHasAudio(acc);
  const tempo = Math.min(2, Math.max(0.5, speed));
  const fc = hasAudio ? `[0:v]setpts=PTS/${speed}[v];[0:a]atempo=${tempo}[a]` : `[0:v]setpts=PTS/${speed}[v]`;
  const maps = hasAudio ? ["-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "192k"] : ["-map", "[v]"];
  ffmpeg(["-i", acc, "-filter_complex", fc, ...maps, "-c:v", "libx264", "-pix_fmt", "yuv420p", outPath]);
}

export function stageMusic(acc, args, musicPath, musicDownbeatSec, outPath) {
  const mix = args["music-mix"] !== "0";
  muxMusic(acc, musicPath, musicDownbeatSec, mix, 0.7, outPath);
}

export function stageCodec(acc, codecSpec, outPath) {
  const cm = CODEC_MAP[codecSpec];
  if (!cm) throw new Error(`bad --codec: ${codecSpec} (expect h264 / h265 / prores)`);
  ffmpeg(["-i", acc, "-c:v", cm.v, ...(cm.extra || []), "-c:a", "copy", outPath]);
}

export function stageColorspace(acc, colorspace, outPath) {
  const cs = CS_MAP[colorspace];
  if (!cs) throw new Error(`bad --colorspace: ${colorspace} (expect rec709 / rec2020 / srgb)`);
  // `colorspace` filter requires the input to declare a source colorspace.
  // We tag the input as bt709 (the renderer's hardcoded pipeline) and let
  // ffmpeg convert toward the target. iall=bt709 + all=<target>.
  ffmpeg(["-i", acc, "-vf", `colorspace=iall=bt709:all=${cs}:fast=1`, "-c:a", "copy", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-colorspace", cs, outPath]);
}

export { CODEC_MAP, CS_MAP };
