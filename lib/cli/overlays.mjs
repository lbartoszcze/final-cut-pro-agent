// PiP overlay helper extracted from lib/render/ffmpeg.mjs.
// Supports corner-style positioning (default) and full-frame blend modes
// (multiply / screen / overlay / softlight / darken / lighten / addition /
// difference) via the ffmpeg blend filter.

import { resolve } from "node:path";
import { ffmpeg } from "../render/ffmpeg.mjs";

const VALID_BLENDS = new Set(["", "multiply", "screen", "overlay", "softlight", "darken", "lighten", "addition", "difference"]);

// Split-screen composition. spec = "side" (left/right), "stack" (top/bottom),
// or "quad" (2x2). Sources is a list of paths; we pad / trim to the project
// duration and tile them. Audio takes from the first source.
export function splitScreen(srcs, aspect, durSec, spec, outPath) {
  if (!srcs || srcs.length < 2) throw new Error("--split needs ≥2 inputs");
  const layouts = {
    side: { cols: 2, rows: 1 },
    stack: { cols: 1, rows: 2 },
    quad: { cols: 2, rows: 2 },
  };
  const layout = layouts[spec];
  if (!layout) throw new Error(`bad --split: ${spec} (expect side / stack / quad)`);
  const used = srcs.slice(0, layout.cols * layout.rows);
  const w = aspect.w, h = aspect.h;
  const tileW = Math.floor(w / layout.cols), tileH = Math.floor(h / layout.rows);
  const inputs = used.flatMap((p) => ["-i", resolve(p)]);
  const scales = used.map((_, i) => `[${i}:v]scale=${tileW}:${tileH}:force_original_aspect_ratio=increase,crop=${tileW}:${tileH},setpts=PTS-STARTPTS[t${i}]`);
  const lay = [];
  used.forEach((_, i) => {
    const col = i % layout.cols, row = Math.floor(i / layout.cols);
    lay.push({ id: `t${i}`, x: col * tileW, y: row * tileH });
  });
  const bg = `color=c=black:s=${w}x${h}:r=30:d=${durSec.toFixed(3)}[bg]`;
  let acc = "bg";
  const overlays = lay.map((l, i) => {
    const out = i === lay.length - 1 ? "v" : `s${i}`;
    const flt = `[${acc}][${l.id}]overlay=${l.x}:${l.y}[${out}]`;
    acc = out;
    return flt;
  });
  const chain = [bg, ...scales, ...overlays].join(";");
  ffmpeg([...inputs, "-filter_complex", chain, "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-t", durSec.toFixed(3), outPath]);
}

export function overlayPip(srcPath, args, aspect, outPath) {
  const ps = Number.parseFloat(args["pip-scale"]);
  if (!Number.isFinite(ps) || ps <= 0 || ps > 1) throw new Error(`bad --pip-scale: ${args["pip-scale"]}`);
  const pw = Math.round(aspect.w * ps), m = 30;
  const xyMap = { tl: `${m}:${m}`, tr: `W-w-${m}:${m}`, bl: `${m}:H-h-${m}`, br: `W-w-${m}:H-h-${m}` };
  const xy = xyMap[args["pip-pos"]];
  if (!xy) throw new Error(`bad --pip-pos: ${args["pip-pos"]} (expect tl/tr/bl/br)`);
  const blend = args["pip-blend"] || "";
  if (!VALID_BLENDS.has(blend)) throw new Error(`bad --pip-blend: ${blend}`);
  const chain = blend
    ? `[0:v]format=yuv420p[base];[1:v]scale=${aspect.w}:${aspect.h}:force_original_aspect_ratio=increase,crop=${aspect.w}:${aspect.h},format=yuv420p[pip];[base][pip]blend=all_mode=${blend}:shortest=1[v]`
    : `[1:v]scale=${pw}:-2[pip];[0:v][pip]overlay=${xy}:shortest=0[v]`;
  ffmpeg([
    "-i", srcPath, "-i", resolve(args.pip),
    "-filter_complex", chain,
    "-map", "[v]", "-map", "0:a?",
    "-c:a", "copy", "-c:v", "libx264", "-pix_fmt", "yuv420p", outPath,
  ]);
}
