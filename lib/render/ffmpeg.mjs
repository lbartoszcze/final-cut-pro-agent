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

// Resolve a frame-rate spec to a {num, den, label} ffmpeg-friendly tuple.
// Accepts shorthand for the common rates: 23.976/24/25/29.97/30/50/59.94/60.
// Anything else is parsed as a float and emitted as <round*1000>/1000.
export function parseFps(spec) {
  const known = {
    "23.976": { num: 24000, den: 1001 }, "23.98": { num: 24000, den: 1001 }, "24000/1001": { num: 24000, den: 1001 },
    "24": { num: 24, den: 1 },
    "25": { num: 25, den: 1 },
    "29.97": { num: 30000, den: 1001 }, "30000/1001": { num: 30000, den: 1001 },
    "30": { num: 30, den: 1 },
    "50": { num: 50, den: 1 },
    "59.94": { num: 60000, den: 1001 }, "60000/1001": { num: 60000, den: 1001 },
    "60": { num: 60, den: 1 },
  };
  if (!spec) return { num: 30000, den: 1001, label: "30000/1001" };
  const k = String(spec);
  if (known[k]) return { ...known[k], label: `${known[k].num}/${known[k].den}` };
  const slash = k.match(/^(\d+)\/(\d+)$/);
  if (slash) return { num: parseInt(slash[1]), den: parseInt(slash[2]), label: k };
  const num = parseFloat(k);
  if (Number.isFinite(num) && num > 0) {
    return { num: Math.round(num * 1000), den: 1000, label: `${Math.round(num * 1000)}/1000` };
  }
  return { num: 30000, den: 1001, label: "30000/1001" };
}

// Parse a w:h aspect-ratio string into a {w, h} pixel target. Common shorthand
// keys are accepted: "16:9" → 1920x1080, "9:16" → 1080x1920, "1:1" → 1080x1080,
// "4:5" → 1080x1350, "2.35:1" → 2048x870. Numeric pixel pairs are also accepted
// (e.g. "1920x1080"). Falls back to 1920x1080.
export function parseAspect(spec) {
  if (!spec) return { w: 1920, h: 1080, mode: "fit" };
  const px = spec.match(/^(\d+)x(\d+)(?::(fit|fill))?$/i);
  if (px) return { w: parseInt(px[1]), h: parseInt(px[2]), mode: (px[3] || "fit").toLowerCase() };
  const ratio = spec.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)(?::(fit|fill))?$/i);
  if (ratio) {
    const a = parseFloat(ratio[1]), b = parseFloat(ratio[2]);
    const mode = (ratio[3] || "fit").toLowerCase();
    if (b >= a) return { w: 1080, h: Math.round(1080 * b / a), mode };
    return { w: Math.round(1080 * a / b), h: 1080, mode };
  }
  return { w: 1920, h: 1080, mode: "fit" };
}

// Build the per-clip frame-fitting filter chain. mode="fit" letterboxes;
// mode="fill" center-crops (the standard 9:16 reframe of 16:9 source).
function fitFilter(w, h, mode) {
  if (mode === "fill") {
    return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  }
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`;
}

// Concatenate clips with cross-fades + per-clip color grade + per-clip audio
// loudness normalization + arbitrary aspect-ratio reframe.
// cuts: { srcIdx, srcInSec, durSec, tOnTimeline }.
// gradeFilter: ffmpeg filter chain from grades.mjs LOOKS, spliced per-clip.
// audioOpts:   { targetLUFS, fadeInSec, fadeOutSec, perClipMeasured }.
// aspect:      { w, h, mode } from parseAspect; w/h drive output resolution.
export function renderClips(clipPaths, cuts, transitions, totalSec, outPath, gradeFilter = "", audioOpts = null, aspect = null, fps = null, opts = null) {
  const fit = aspect || { w: 1920, h: 1080, mode: "fit" };
  const fr = fps || { num: 30000, den: 1001, label: "30000/1001" };
  if (cuts.length === 0) {
    return ffmpeg(["-f", "lavfi", "-i", `color=c=black:s=${fit.w}x${fit.h}:r=${fr.label}:d=${totalSec.toFixed(3)}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", outPath]);
  }
  const grade = gradeFilter ? `,${gradeFilter}` : "";
  const fitChain = fitFilter(fit.w, fit.h, fit.mode);
  const inputs = clipPaths.flatMap((p) => ["-i", p]);
  const filters = [];
  // Fade-from-black on the first cut, fade-to-black on the last cut. Both
  // default off; opt in via opts.fadeFromBlackSec / fadeToBlackSec.
  const fbBlackIn = (opts && opts.fadeFromBlackSec) || 0;
  const fbBlackOut = (opts && opts.fadeToBlackSec) || 0;
  cuts.forEach((c, i) => {
    const isFirst = i === 0;
    const isLast = i === cuts.length - 1;
    // Mid-cut seam softeners (small fades on every cut except the first/last
    // edge — separate from from-black / to-black).
    const seamIn = isFirst ? "" : `,fade=t=in:st=0:d=0.05`;
    const seamOut = isLast ? "" : `,fade=t=out:st=${Math.max(0, c.durSec - 0.1).toFixed(3)}:d=0.1`;
    // Edge fades to / from black (longer, more deliberate).
    const edgeIn = isFirst && fbBlackIn > 0 ? `,fade=t=in:color=black:st=0:d=${fbBlackIn.toFixed(3)}` : "";
    const edgeOut = isLast && fbBlackOut > 0 ? `,fade=t=out:color=black:st=${Math.max(0, c.durSec - fbBlackOut).toFixed(3)}:d=${fbBlackOut.toFixed(3)}` : "";
    filters.push(`[${c.srcIdx}:v]trim=start=${c.srcInSec.toFixed(3)}:duration=${c.durSec.toFixed(3)},setpts=PTS-STARTPTS,${fitChain},fps=${fr.label}${grade}${seamIn}${seamOut}${edgeIn}${edgeOut}[v${i}]`);
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
  cmd.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", fr.label, "-t", totalSec.toFixed(3), outPath);
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
