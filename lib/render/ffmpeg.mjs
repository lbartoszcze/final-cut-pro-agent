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

// Has-audio probe: returns true if the file contains at least one audio
// stream. Matters because per-clip loudnorm + adjust-volume should only be
// applied to clips that actually carry audio (silent test patterns shouldn't
// get the audio chain).
export function ffprobeHasAudio(path) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", path], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim().length > 0;
}

// Run loudnorm in measure-only mode (one ffmpeg pass) and return the per-clip
// integrated loudness in LUFS plus true peak. Used to decide a per-clip gain
// adjustment toward a target. Returns null when the clip has no audio.
export function probeLoudness(path) {
  if (!ffprobeHasAudio(path)) return null;
  const r = spawnSync("ffmpeg", [
    "-hide_banner", "-nostats", "-i", path,
    "-vn", "-af", "loudnorm=print_format=json",
    "-f", "null", "-",
  ], { encoding: "utf8" });
  const stderr = r.stderr || "";
  // The JSON block is the last { ... } in stderr.
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const obj = JSON.parse(stderr.slice(start, end + 1));
    return {
      inputI: parseFloat(obj.input_i),
      inputTP: parseFloat(obj.input_tp),
      inputLRA: parseFloat(obj.input_lra),
    };
  } catch {
    return null;
  }
}

// Build the ffmpeg audio filter chain that brings a clip from its measured
// loudness to a target LUFS, with optional clip-edge fades. Returns a string
// that slots into renderClips' per-clip audio pipeline.
//   targetLUFS: integrated-loudness target (e.g. -16 web, -14 YouTube, -23 EBU R128)
//   measured:   { inputI, inputTP, inputLRA } from probeLoudness, or null
//   fadeInSec / fadeOutSec / clipDurSec: optional clip-edge fades
export function audioFilterChain(targetLUFS, measured, fadeInSec, fadeOutSec, clipDurSec) {
  const parts = [];
  if (measured && Number.isFinite(measured.inputI)) {
    // Use loudnorm in linear mode with the measured values for stable
    // single-pass normalization. Falls back to dynamic mode if values
    // look invalid (e.g. silence reports input_i=-inf).
    if (Number.isFinite(measured.inputTP) && Number.isFinite(measured.inputLRA) && measured.inputI > -70) {
      parts.push(`loudnorm=I=${targetLUFS}:TP=-1.5:LRA=11:measured_I=${measured.inputI.toFixed(2)}:measured_TP=${measured.inputTP.toFixed(2)}:measured_LRA=${measured.inputLRA.toFixed(2)}:linear=true:print_format=summary`);
    } else {
      parts.push(`loudnorm=I=${targetLUFS}:TP=-1.5:LRA=11`);
    }
  } else if (measured === null) {
    // No measurement (silent or audio-less clip): keep silence.
    parts.push("anull");
  } else {
    parts.push(`loudnorm=I=${targetLUFS}:TP=-1.5:LRA=11`);
  }
  if (fadeInSec > 0) parts.push(`afade=t=in:st=0:d=${fadeInSec.toFixed(3)}`);
  if (fadeOutSec > 0 && clipDurSec > 0) {
    const start = Math.max(0, clipDurSec - fadeOutSec);
    parts.push(`afade=t=out:st=${start.toFixed(3)}:d=${fadeOutSec.toFixed(3)}`);
  }
  return parts.join(",");
}

// Concatenate clips with cross-fades + per-clip color grade + per-clip audio
// loudness normalization. cuts: { srcIdx, srcInSec, durSec, tOnTimeline }.
// gradeFilter: ffmpeg filter chain from grades.mjs LOOKS, spliced per-clip.
// audioOpts:   { targetLUFS, fadeInSec, fadeOutSec, perClipMeasured } —
//              when set, each clip's audio gets a loudnorm filter and
//              optional clip-edge fades; clips without audio are filled
//              with matching-length silence so concat audio stays valid.
export function renderClips(clipPaths, cuts, transitions, totalSec, outPath, gradeFilter = "", audioOpts = null) {
  if (cuts.length === 0) {
    return ffmpeg(["-f", "lavfi", "-i", `color=c=black:s=1920x1080:r=30000/1001:d=${totalSec.toFixed(3)}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", outPath]);
  }
  const grade = gradeFilter ? `,${gradeFilter}` : "";
  const inputs = clipPaths.flatMap((p) => ["-i", p]);
  const filters = [];
  cuts.forEach((c, i) => {
    const fadeIn = i === 0 ? "" : `,fade=t=in:st=0:d=0.05`;
    const fadeOut = i === cuts.length - 1 ? "" : `,fade=t=out:st=${Math.max(0, c.durSec - 0.1).toFixed(3)}:d=0.1`;
    filters.push(`[${c.srcIdx}:v]trim=start=${c.srcInSec.toFixed(3)}:duration=${c.durSec.toFixed(3)},setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30000/1001${grade}${fadeIn}${fadeOut}[v${i}]`);
  });
  if (audioOpts) {
    cuts.forEach((c, i) => {
      const measured = audioOpts.perClipMeasured ? audioOpts.perClipMeasured[c.srcIdx] : null;
      if (measured) {
        const chain = audioFilterChain(audioOpts.targetLUFS, measured, audioOpts.fadeInSec || 0, audioOpts.fadeOutSec || 0, c.durSec);
        filters.push(`[${c.srcIdx}:a]atrim=start=${c.srcInSec.toFixed(3)}:duration=${c.durSec.toFixed(3)},asetpts=PTS-STARTPTS,${chain}[a${i}]`);
      } else {
        filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${c.durSec.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
      }
    });
  }
  const concatLabels = cuts.map((_, i) => audioOpts ? `[v${i}][a${i}]` : `[v${i}]`).join("");
  if (audioOpts) {
    filters.push(`${concatLabels}concat=n=${cuts.length}:v=1:a=1[vout][aout]`);
    filters.push(`[vout]trim=duration=${totalSec.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[out]`);
    filters.push(`[aout]atrim=duration=${totalSec.toFixed(3)},asetpts=PTS-STARTPTS[outa]`);
  } else {
    filters.push(`${concatLabels}concat=n=${cuts.length}:v=1:a=0,format=yuv420p[concat]`);
    filters.push(`[concat]trim=duration=${totalSec.toFixed(3)},setpts=PTS-STARTPTS[out]`);
  }
  const cmd = [...inputs, "-filter_complex", filters.join(";"), "-map", "[out]"];
  if (audioOpts) cmd.push("-map", "[outa]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000");
  cmd.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30000/1001", "-t", totalSec.toFixed(3), outPath);
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
