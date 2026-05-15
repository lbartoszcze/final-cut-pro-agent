// Per-source-clip preprocessing. Today: 2-pass libvidstab stabilization.
//
// Stabilization must run before trim because vidstabtransform applies a
// frame-indexed transforms file — trimming would misalign it. We cache one
// stabilized .mp4 per source under workDir/stab/<hash>.mp4 and return the
// mapping so renderClips can use the stabilized path in place of the source.

import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";

function cacheKey(srcPath, opts) {
  const st = statSync(srcPath);
  const h = createHash("sha1");
  h.update(srcPath);
  h.update(String(st.size));
  h.update(String(Math.floor(st.mtimeMs)));
  h.update(JSON.stringify(opts || {}));
  return h.digest("hex").slice(0, 16);
}

function runFfmpeg(args) {
  const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("ffmpeg failed:\n" + (r.stderr || "").slice(-2000));
}

export function stabilizeClip(srcPath, workDir, opts) {
  const o = opts || {};
  const shakiness = Number.isFinite(o.shakiness) ? o.shakiness : 6;
  const smoothing = Number.isFinite(o.smoothing) ? o.smoothing : 15;
  const zoom = Number.isFinite(o.zoom) ? o.zoom : 5;
  const cacheDir = join(workDir, "stab");
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const k = cacheKey(srcPath, { shakiness, smoothing, zoom });
  const trf = join(cacheDir, `${k}.trf`);
  const out = join(cacheDir, `${k}.mp4`);
  if (existsSync(out)) return out;
  // Pass 1: detect transforms.
  runFfmpeg(["-i", srcPath, "-vf", `vidstabdetect=result=${trf}:shakiness=${shakiness}:accuracy=15`, "-f", "null", "-"]);
  // Pass 2: apply transforms; zoom slightly to hide the resulting borders.
  runFfmpeg(["-i", srcPath, "-vf", `vidstabtransform=input=${trf}:zoom=${zoom}:smoothing=${smoothing}:interpol=linear,unsharp=5:5:0.8:3:3:0.4`, "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", out]);
  return out;
}

export function stabilizeClips(clipPaths, workDir, opts) {
  return clipPaths.map((p) => stabilizeClip(p, workDir, opts));
}
