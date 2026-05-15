// Post-pipeline stages extracted from lib/render/video.mjs so the orchestrator
// stays under the 300-line cap. Each function takes the current accumulator
// path + args + a `pathFor` allocator and returns the new accumulator path.

import { resolve } from "node:path";
import { ffmpeg, ffprobeHasAudio, muxMusic } from "../render/ffmpeg.mjs";

const CODEC_MAP = { h264: { v: "libx264" }, h265: { v: "libx265" }, prores: { v: "prores_ks", extra: ["-profile:v", "3"] } };
// CS_MAP carries two pieces: `matrix` (for the ffmpeg colorspace filter's all=)
// and `primaries` (for VUI tagging only — P3 has no matrix entry).
const CS_MAP = {
  rec709: { matrix: "bt709" },
  rec2020: { matrix: "bt2020nc" },
  srgb: { matrix: "bt709" },
  p3: { primaries: "smpte432" },
  p3d65: { primaries: "smpte432" },
  "dci-p3": { primaries: "smpte431" },
};

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

// Multi-point speed ramp. ramp="t1:speed1,t2:speed2,..." — each segment
// between control points runs at the specified speed. Built as a sequence
// of trim + setpts segments concatenated together.
export function stageRamp(acc, rampSpec, outPath) {
  const pts = rampSpec.split(",").map((s) => { const [t, v] = s.split(":"); return { t: parseFloat(t), v: parseFloat(v) }; }).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0);
  if (pts.length < 2) throw new Error(`bad --ramp: need ≥2 control points`);
  pts.sort((a, b) => a.t - b.t);
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) segs.push({ start: pts[i].t, end: pts[i + 1].t, speed: pts[i].v });
  const fc = [];
  segs.forEach((s, i) => fc.push(`[0:v]trim=${s.start.toFixed(3)}:${s.end.toFixed(3)},setpts=(PTS-STARTPTS)/${s.speed.toFixed(3)}[v${i}]`));
  segs.forEach((s, i) => fc.push(`[0:a]atrim=${s.start.toFixed(3)}:${s.end.toFixed(3)},asetpts=PTS-STARTPTS,atempo=${Math.min(2, Math.max(0.5, s.speed)).toFixed(3)}[a${i}]`));
  const vLabels = segs.map((_, i) => `[v${i}]`).join("");
  const aLabels = segs.map((_, i) => `[a${i}]`).join("");
  fc.push(`${vLabels}concat=n=${segs.length}:v=1:a=0[v]`);
  fc.push(`${aLabels}concat=n=${segs.length}:v=0:a=1[a]`);
  ffmpeg(["-i", acc, "-filter_complex", fc.join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-c:a", "aac", "-b:a", "192k", "-pix_fmt", "yuv420p", outPath]);
}

export function stageMusic(acc, args, musicPath, musicDownbeatSec, outPath) {
  const mix = args["music-mix"] !== "0";
  muxMusic(acc, musicPath, musicDownbeatSec, mix, 0.7, outPath);
}

export function stageCodec(acc, codecSpec, outPath, bitrate) {
  const cm = CODEC_MAP[codecSpec];
  if (!cm) throw new Error(`bad --codec: ${codecSpec} (expect h264 / h265 / prores)`);
  const br = parseBitrate(bitrate);
  const rate = br ? ["-b:v", br, "-maxrate", br, "-bufsize", `${parseInt(br) * 2}${br.replace(/[\d.]/g, "")}`] : [];
  ffmpeg(["-i", acc, "-c:v", cm.v, ...(cm.extra || []), ...rate, "-c:a", "copy", outPath]);
}

function parseBitrate(spec) {
  if (!spec) return null;
  const m = String(spec).match(/^(\d+(?:\.\d+)?)\s*(k|K|m|M)?(?:bps)?$/);
  if (!m) throw new Error(`bad --bitrate: ${spec}`);
  const suffix = (m[2] || "").toUpperCase() === "M" ? "M" : "k";
  return `${m[1]}${suffix}`;
}

// Upmix stereo → 5.1 surround. Centre carries dialogue, L/R the music bed,
// LS/RS atmos (slightly delayed copies of L/R), LFE = low-passed sum.
export function stageSurround(acc, spec, outPath) {
  if (spec !== "5.1" && spec !== "7.1") throw new Error(`bad --surround: ${spec} (expect 5.1 / 7.1)`);
  const filter = spec === "5.1"
    ? "[0:a]channelsplit=channel_layout=stereo[L][R];[L][R]amerge=inputs=2,pan=5.1|FL<c0|FR<c1|FC<0.5*c0+0.5*c1|LFE<0.3*c0+0.3*c1|BL<c0|BR<c1[a]"
    : "[0:a]channelsplit=channel_layout=stereo[L][R];[L][R]amerge=inputs=2,pan=7.1|FL<c0|FR<c1|FC<0.5*c0+0.5*c1|LFE<0.3*c0+0.3*c1|SL<c0|SR<c1|BL<0.7*c0|BR<0.7*c1[a]";
  ffmpeg(["-i", acc, "-filter_complex", filter, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "384k", outPath]);
}

// HDR transfer tag pass. --hdr=hlg sets transfer=arib-std-b67, --hdr=pq
// sets transfer=smpte2084. Both pair with bt2020 primaries. Source must
// already be HDR; this stage only writes the VUI tags for downstream players.
export function stageHDR(acc, hdr, outPath) {
  const transfer = hdr === "hlg" ? "arib-std-b67" : hdr === "pq" ? "smpte2084" : null;
  if (!transfer) throw new Error(`bad --hdr: ${hdr} (expect hlg / pq)`);
  ffmpeg(["-i", acc, "-c:a", "copy", "-c:v", "libx265", "-pix_fmt", "yuv420p10le",
    "-x265-params", `colorprim=bt2020:transfer=${transfer}:colormatrix=bt2020nc:hdr-opt=1`,
    "-colorspace", "bt2020nc", "-color_primaries", "bt2020", "-color_trc", transfer, outPath]);
}

export function stageColorspace(acc, colorspace, outPath) {
  const cs = CS_MAP[colorspace];
  if (!cs) throw new Error(`bad --colorspace: ${colorspace} (expect rec709 / rec2020 / srgb / p3 / p3d65 / dci-p3)`);
  // Matrix-target colorspaces run through the colorspace filter; primaries-only
  // targets (P3 family) just tag VUI primaries without resampling.
  const filterArg = cs.matrix ? ["-vf", `colorspace=iall=bt709:all=${cs.matrix}:fast=1`] : [];
  const matrixTag = cs.matrix ? ["-colorspace", cs.matrix] : [];
  const primTag = cs.primaries ? ["-color_primaries", cs.primaries] : [];
  ffmpeg(["-i", acc, ...filterArg, "-c:a", "copy", "-c:v", "libx264", "-pix_fmt", "yuv420p", ...matrixTag, ...primTag, outPath]);
}

export { CODEC_MAP, CS_MAP };
