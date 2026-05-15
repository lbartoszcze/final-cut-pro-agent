// PiP overlay helper extracted from lib/render/ffmpeg.mjs.
// Supports corner-style positioning (default) and full-frame blend modes
// (multiply / screen / overlay / softlight / darken / lighten / addition /
// difference) via the ffmpeg blend filter.

import { resolve } from "node:path";
import { ffmpeg } from "../render/ffmpeg.mjs";

const VALID_BLENDS = new Set(["", "multiply", "screen", "overlay", "softlight", "darken", "lighten", "addition", "difference"]);

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
