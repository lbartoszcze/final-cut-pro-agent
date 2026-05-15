// Source-clip discovery and synthesis helpers extracted from make-cut.mjs.
// Pure IO + ffmpeg shells; no FCPXML or cadence coupling.

import { readdirSync, statSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join, resolve, extname } from "node:path";

const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".mkv", ".avi"]);

export function listClipsInFolder(folder) {
  const abs = resolve(folder);
  return readdirSync(abs)
    .filter((n) => VIDEO_EXT.has(extname(n).toLowerCase()))
    .map((n) => join(abs, n))
    .filter((p) => statSync(p).isFile())
    .sort();
}

export function probeDurationFrames(path, fps) {
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path], { encoding: "utf8" }).trim();
    const sec = parseFloat(out);
    if (!Number.isFinite(sec) || sec <= 0) return Math.round(20 * fps);
    return Math.max(Math.round(fps), Math.round(sec * fps));
  } catch {
    return Math.round(20 * fps);
  }
}

export function makeTestPatterns(workDir, rateNum, rateDen) {
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
      const filter = `${palette[i]}:s=1920x1080:r=${rateNum}/${rateDen}:d=8,drawtext=text='SCENE ${i + 1}':fontcolor=white:fontsize=120:x=(w-text_w)/2:y=(h-text_h)/2`;
      const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", filter, "-c:v", "libx264", "-pix_fmt", "yuv420p", path], { encoding: "utf8" });
      if (r.status !== 0) throw new Error("ffmpeg failed:\n" + (r.stderr || "").slice(-1000));
    }
    out.push(path);
  }
  return out;
}
