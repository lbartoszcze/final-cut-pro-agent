// ffmpeg helpers for the direct video renderer.
// Pure shell-out wrappers; no FCP / fcpxml coupling.

import { spawnSync } from "node:child_process";

export function ffmpeg(args) {
  const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("ffmpeg failed:\n" + (r.stderr || "").slice(-2000));
}

export function ffprobeDurationSec(path) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path], { encoding: "utf8" });
  if (r.status !== 0) return 0;
  const sec = parseFloat(r.stdout.trim());
  return Number.isFinite(sec) && sec > 0 ? sec : 0;
}

// Concatenate clips with optional cross-fades. cuts is an array of:
//   { srcIdx, srcInSec, durSec, tOnTimeline }
// transitions is an array of:
//   { tOnTimeline, durSec, kind: 'xfade' }
// Each cut becomes a trimmed, padded segment; overlapping segments are
// xfaded; non-overlapping segments are concatenated head-to-tail.
export function renderClips(clipPaths, cuts, transitions, totalSec, outPath) {
  if (cuts.length === 0) {
    return ffmpeg(["-f", "lavfi", "-i", `color=c=black:s=1920x1080:r=30000/1001:d=${totalSec.toFixed(3)}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", outPath]);
  }
  const inputs = clipPaths.flatMap((p) => ["-i", p]);
  const filters = [];
  cuts.forEach((c, i) => {
    const fadeIn = i === 0 ? "" : `,fade=t=in:st=0:d=0.05`;
    const fadeOut = i === cuts.length - 1 ? "" : `,fade=t=out:st=${Math.max(0, c.durSec - 0.1).toFixed(3)}:d=0.1`;
    filters.push(`[${c.srcIdx}:v]trim=start=${c.srcInSec.toFixed(3)}:duration=${c.durSec.toFixed(3)},setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30000/1001${fadeIn}${fadeOut}[v${i}]`);
  });
  // Concat in order. xfade transitions are emulated as overlapping fade-out
  // on segment N and fade-in on segment N+1; for the first pass we just
  // concat — the per-segment fades above already handle the seam softening.
  const concatLabels = cuts.map((_, i) => `[v${i}]`).join("");
  filters.push(`${concatLabels}concat=n=${cuts.length}:v=1:a=0,format=yuv420p[concat]`);
  filters.push(`[concat]trim=duration=${totalSec.toFixed(3)},setpts=PTS-STARTPTS[out]`);

  const cmd = [...inputs, "-filter_complex", filters.join(";"), "-map", "[out]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30000/1001", "-t", totalSec.toFixed(3), outPath];
  ffmpeg(cmd);
}

// Overlay every title in the plan onto an existing video file via drawtext.
// Each title gets a fade-in, a hold, and a fade-out. The escapeText helper
// makes drawtext-safe versions of the user-supplied text.
function escapeText(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
}

export function overlayTitles(srcPath, titles, totalSec, outPath) {
  if (titles.length === 0) {
    ffmpeg(["-i", srcPath, "-c", "copy", outPath]);
    return;
  }
  const drawtextFilters = titles.map((t) => {
    const fadeLen = Math.min(0.4, t.durSec * 0.2);
    const enable = `between(t,${t.tOnTimeline.toFixed(3)},${(t.tOnTimeline + t.durSec).toFixed(3)})`;
    const alpha = `if(lt(t,${(t.tOnTimeline + fadeLen).toFixed(3)}),(t-${t.tOnTimeline.toFixed(3)})/${fadeLen.toFixed(3)},if(gt(t,${(t.tOnTimeline + t.durSec - fadeLen).toFixed(3)}),(${(t.tOnTimeline + t.durSec).toFixed(3)}-t)/${fadeLen.toFixed(3)},1))`;
    return `drawtext=text='${escapeText(t.text)}':fontcolor=white:fontsize=96:fontfile=/System/Library/Fonts/Helvetica.ttc:x=(w-text_w)/2:y=(h-text_h)/2:enable='${enable}':alpha='${alpha}':box=1:boxcolor=black@0.4:boxborderw=20`;
  });
  ffmpeg(["-i", srcPath, "-vf", drawtextFilters.join(","), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", totalSec.toFixed(3), outPath]);
}

// Synthetic color-fill input for filler / placeholder gaps.
export function renderColor(hex, durSec, outPath) {
  ffmpeg(["-f", "lavfi", "-i", `color=c=${hex}:s=1920x1080:r=30000/1001:d=${durSec.toFixed(3)}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", outPath]);
}
