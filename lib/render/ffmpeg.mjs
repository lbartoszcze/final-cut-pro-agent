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

// `mcompand`'s `|` band separator collides with the comma-separated filter
// chain inside renderClips; use single-band `compand` as the safe default.
export function audioFilterChain(targetLUFS, measured, fadeInSec, fadeOutSec, clipDurSec, extra) {
  const parts = [];
  if (extra?.denoise) parts.push("afftdn=nr=12:nt=w");
  if (extra?.highpass) parts.push(`highpass=f=${extra.highpass}`);
  if (extra?.eqBass) parts.push(`bass=g=${extra.eqBass}`);
  if (extra?.eqMid) parts.push(`equalizer=f=1000:width_type=h:width=400:g=${extra.eqMid}`);
  if (extra?.eqTreble) parts.push(`treble=g=${extra.eqTreble}`);
  if (extra?.multibandComp) parts.push(`compand=attacks=0.005:decays=0.05:points=-90/-90\\|-20/-12\\|0/-6`);
  if (measured && Number.isFinite(measured.inputI) && Number.isFinite(measured.inputTP) && Number.isFinite(measured.inputLRA) && measured.inputI > -70)
    parts.push(`loudnorm=I=${targetLUFS}:TP=-1.5:LRA=11:measured_I=${measured.inputI.toFixed(2)}:measured_TP=${measured.inputTP.toFixed(2)}:measured_LRA=${measured.inputLRA.toFixed(2)}:linear=true:print_format=summary`);
  else if (measured === null) parts.push("anull");
  else parts.push(`loudnorm=I=${targetLUFS}:TP=-1.5:LRA=11`);
  if (extra?.limit) parts.push("alimiter=limit=0.95:level=disabled");
  if (fadeInSec > 0) parts.push(`afade=t=in:st=0:d=${fadeInSec.toFixed(3)}`);
  if (fadeOutSec > 0 && clipDurSec > 0) parts.push(`afade=t=out:st=${Math.max(0, clipDurSec - fadeOutSec).toFixed(3)}:d=${fadeOutSec.toFixed(3)}`);
  return parts.join(",");
}

// Distribution-platform presets — one --platform=<name> flag fills sensible
// defaults for audio loudness target, length cap, aspect, fps. Per-flag
// overrides still win since callers fall back to PLATFORMS[name][key] only
// when the user didn't explicitly pass --<key>.
export const PLATFORMS = {
  "youtube":            { audioTarget: -14, maxDuration: null, aspect: "16:9",      fps: "29.97" },
  "youtube-shorts":     { audioTarget: -14, maxDuration: 60,   aspect: "9:16:fill", fps: "29.97" },
  "tiktok":             { audioTarget: -14, maxDuration: 60,   aspect: "9:16:fill", fps: "29.97" },
  "reels":              { audioTarget: -14, maxDuration: 90,   aspect: "9:16:fill", fps: "29.97" },
  "instagram-feed":     { audioTarget: -14, maxDuration: 60,   aspect: "1:1:fill",  fps: "29.97" },
  "instagram-portrait": { audioTarget: -14, maxDuration: 60,   aspect: "4:5:fill",  fps: "29.97" },
  "twitter":            { audioTarget: -14, maxDuration: 140,  aspect: "16:9",      fps: "29.97" },
  "broadcast":          { audioTarget: -23, maxDuration: null, aspect: "16:9",      fps: "25" },
  "broadcast-us":       { audioTarget: -24, maxDuration: null, aspect: "16:9",      fps: "29.97" },
  "cinema":             { audioTarget: -23, maxDuration: null, aspect: "2.35:1",    fps: "24" },
};

export function resolvePlatform(name) {
  if (!name) return null;
  const p = PLATFORMS[name];
  if (!p) throw new Error(`unknown --platform: ${name}. Known: ${Object.keys(PLATFORMS).join(", ")}`);
  return p;
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

// Find a planned dissolve at the boundary preceding cut i. Returns the cross
// dissolve duration in seconds or 0 for a hard cut.
function transitionBefore(transitions, cuts, i) {
  if (i === 0 || !transitions || transitions.length === 0) return 0;
  for (const t of transitions) if (Math.abs(t.tOnTimeline - cuts[i].tOnTimeline) < 0.05) return Math.max(0, t.durSec || 0);
  return 0;
}

// Concatenate cuts; xfade where the plan calls for a dissolve, concat
// otherwise. Audio mirrors video with acrossfade at dissolve boundaries.
export function renderClips(clipPaths, cuts, transitions, totalSec, outPath, gradeFilter, audioOpts, aspect, fps, opts) {
  const fit = aspect || { w: 1920, h: 1080, mode: "fit" };
  const fr = fps || { num: 30000, den: 1001, label: "30000/1001" };
  if (cuts.length === 0) return ffmpeg(["-f", "lavfi", "-i", `color=c=black:s=${fit.w}x${fit.h}:r=${fr.label}:d=${totalSec.toFixed(3)}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", outPath]);
  const grade = gradeFilter ? `,${gradeFilter}` : "";
  const fitChain = fitFilter(fit.w, fit.h, fit.mode);
  const fbIn = (opts && opts.fadeFromBlackSec) || 0;
  const fbOut = (opts && opts.fadeToBlackSec) || 0;
  const filters = [];
  const jcut = (opts && opts.jcutSec) || 0;
  const lcut = (opts && opts.lcutSec) || 0;
  cuts.forEach((c, i) => filters.push(`[${c.srcIdx}:v]trim=start=${c.srcInSec.toFixed(3)}:duration=${c.durSec.toFixed(3)},setpts=PTS-STARTPTS,${c.vFilter ? c.vFilter + "," : ""}${fitChain},setsar=1,fps=${fr.label}${grade}[v${i}]`));
  const segs = [{ first: 0, last: 0 }];
  for (let i = 1; i < cuts.length; i++) {
    const d = transitionBefore(transitions, cuts, i);
    if (d > 0) segs.push({ first: i, last: i, dissolve: d });
    else segs[segs.length - 1].last = i;
  }
  // J/L cut audio extensions at segment-to-segment dissolves only.
  const aStart = cuts.map((c) => c.srcInSec), aDurA = cuts.map((c) => c.durSec);
  segs.forEach((s, k) => {
    if (k > 0 && jcut > 0) { const sh = Math.min(jcut, cuts[s.first].srcInSec); aStart[s.first] = cuts[s.first].srcInSec - sh; aDurA[s.first] = cuts[s.first].durSec + sh; }
    if (k < segs.length - 1 && lcut > 0) aDurA[s.last] = cuts[s.last].durSec + lcut;
  });
  if (audioOpts) cuts.forEach((c, i) => {
    const m = audioOpts.perClipMeasured ? audioOpts.perClipMeasured[c.srcIdx] : null;
    if (m) filters.push(`[${c.srcIdx}:a]atrim=start=${aStart[i].toFixed(3)}:duration=${aDurA[i].toFixed(3)},asetpts=PTS-STARTPTS,${audioFilterChain(audioOpts.targetLUFS, m, audioOpts.fadeInSec || 0, audioOpts.fadeOutSec || 0, aDurA[i], audioOpts.extra)}[a${i}]`);
    else filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${aDurA[i].toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
  });
  segs.forEach((s, k) => {
    const n = s.last - s.first + 1;
    s.dur = 0; for (let i = s.first; i <= s.last; i++) s.dur += cuts[i].durSec;
    if (n === 1) { s.vLabel = `v${s.first}`; s.aLabel = audioOpts ? `a${s.first}` : null; return; }
    filters.push(`${cuts.slice(s.first, s.last + 1).map((_, j) => `[v${s.first + j}]`).join("")}concat=n=${n}:v=1:a=0[sv${k}]`);
    s.vLabel = `sv${k}`;
    if (audioOpts) { filters.push(`${cuts.slice(s.first, s.last + 1).map((_, j) => `[a${s.first + j}]`).join("")}concat=n=${n}:v=0:a=1[sa${k}]`); s.aLabel = `sa${k}`; }
  });
  let aV = segs[0].vLabel, aA = segs[0].aLabel, aDur = segs[0].dur;
  for (let k = 1; k < segs.length; k++) {
    const d = Math.min(segs[k].dissolve, aDur - 0.1, segs[k].dur - 0.1);
    filters.push(`[${aV}][${segs[k].vLabel}]xfade=transition=${(opts && opts.transition) || "fade"}:duration=${d.toFixed(3)}:offset=${Math.max(0, aDur - d).toFixed(3)}[xv${k}]`);
    aV = `xv${k}`;
    if (audioOpts) { const ad = d + jcut + lcut; filters.push(`[${aA}][${segs[k].aLabel}]acrossfade=d=${ad.toFixed(3)}:c1=tri:c2=tri[xa${k}]`); aA = `xa${k}`; }
    aDur = aDur + segs[k].dur - d;
  }
  const edgeIn = fbIn > 0 ? `fade=t=in:color=black:st=0:d=${fbIn.toFixed(3)},` : "";
  const edgeOut = fbOut > 0 ? `fade=t=out:color=black:st=${Math.max(0, totalSec - fbOut).toFixed(3)}:d=${fbOut.toFixed(3)},` : "";
  filters.push(`[${aV}]${edgeIn}${edgeOut}trim=duration=${totalSec.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[out]`);
  if (audioOpts) filters.push(`[${aA}]atrim=duration=${totalSec.toFixed(3)},asetpts=PTS-STARTPTS[outa]`);
  const cmd = [...clipPaths.flatMap((p) => ["-i", p]), "-filter_complex", filters.join(";"), "-map", "[out]"];
  if (audioOpts) cmd.push("-map", "[outa]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000");
  cmd.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", fr.label, "-t", totalSec.toFixed(3), outPath);
  ffmpeg(cmd);
}

// Overlay titles via drawtext (fade-in, hold, fade-out per title).
function escapeText(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");
}

export function overlayTitles(srcPath, titles, totalSec, outPath, aspect, font) {
  if (titles.length === 0) { ffmpeg(["-i", srcPath, "-c", "copy", outPath]); return; }
  const fontFile = font || "/System/Library/Fonts/Helvetica.ttc";
  // Title-safe positioning: lower-thirds use the upper-middle on vertical
  // formats (so the social UI doesn't sit on top), bottom on landscape.
  // 5% horizontal + 10% vertical inset = 90% title-safe per SMPTE.
  const vertical = aspect && aspect.h > aspect.w;
  // Lower-thirds slide in from the left across a 0.4s window.
  const styleFor = (pos, t) => pos === "lower-third"
    ? { sz: vertical ? 48 : 64, x: `if(lt(t,${(t.tOnTimeline + 0.4).toFixed(3)}),w*0.05-w*0.10*(1-(t-${t.tOnTimeline.toFixed(3)})/0.4),w*0.05)`, y: vertical ? "h*0.72" : "h-h*0.18", box: "1", bc: "black@0.6", bw: "16" }
    : pos === "end-card" ? { sz: vertical ? 96 : 130, x: "(w-text_w)/2", y: "(h-text_h)/2", box: "0", bc: "black@0", bw: "0" }
    : { sz: vertical ? 72 : 96, x: "(w-text_w)/2", y: "(h-text_h)/2", box: "1", bc: "black@0.4", bw: "20" };
  const drawtextFilters = titles.map((t) => {
    const s = styleFor(t.position, t);
    const fadeLen = Math.min(0.4, t.durSec * 0.2);
    const enable = `between(t,${t.tOnTimeline.toFixed(3)},${(t.tOnTimeline + t.durSec).toFixed(3)})`;
    const alpha = `if(lt(t,${(t.tOnTimeline + fadeLen).toFixed(3)}),(t-${t.tOnTimeline.toFixed(3)})/${fadeLen.toFixed(3)},if(gt(t,${(t.tOnTimeline + t.durSec - fadeLen).toFixed(3)}),(${(t.tOnTimeline + t.durSec).toFixed(3)}-t)/${fadeLen.toFixed(3)},1))`;
    return `drawtext=text='${escapeText(t.text)}':fontcolor=white:fontsize=${s.sz}:fontfile=${fontFile}:x='${s.x}':y='${s.y}':enable='${enable}':alpha='${alpha}':box=${s.box}:boxcolor=${s.bc}:boxborderw=${s.bw}`;
  });
  const audio = ffprobeHasAudio(srcPath) ? ["-c:a", "copy", "-map", "0:a"] : [];
  ffmpeg(["-i", srcPath, "-vf", drawtextFilters.join(","), "-map", "0:v", ...audio, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-t", totalSec.toFixed(3), outPath]);
}

// Overlay short B-roll cutaway clips on top of an already-rendered main video.
// brolls: [{ srcPath, srcInSec, durSec, tOnTimeline }]
// Each broll covers the main video for its duration window; audio stays main.
export function overlayBrolls(srcPath, brolls, outPath, aspect) {
  if (!brolls || brolls.length === 0) { ffmpeg(["-i", srcPath, "-c", "copy", outPath]); return; }
  const w = aspect?.w || 1920, h = aspect?.h || 1080;
  const srcs = [...new Set(brolls.map((b) => b.srcPath))];
  const srcIdx = new Map(srcs.map((s, i) => [s, i + 1]));
  const filters = [];
  brolls.forEach((b, i) => filters.push(`[${srcIdx.get(b.srcPath)}:v]trim=start=${b.srcInSec.toFixed(3)}:duration=${b.durSec.toFixed(3)},setpts=PTS-STARTPTS+${b.tOnTimeline.toFixed(3)}/TB,scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}[b${i}]`));
  let acc = "0:v";
  brolls.forEach((b, i) => {
    const next = i === brolls.length - 1 ? "vout" : `m${i}`;
    filters.push(`[${acc}][b${i}]overlay=enable='between(t,${b.tOnTimeline.toFixed(3)},${(b.tOnTimeline + b.durSec).toFixed(3)})'[${next}]`);
    acc = next;
  });
  const inputs = ["-i", srcPath, ...srcs.flatMap((s) => ["-i", s])];
  const audio = ffprobeHasAudio(srcPath) ? ["-map", "0:a", "-c:a", "copy"] : [];
  ffmpeg([...inputs, "-filter_complex", filters.join(";"), "-map", "[vout]", ...audio, "-c:v", "libx264", "-pix_fmt", "yuv420p", outPath]);
}

// Synthetic color-fill input for filler / placeholder gaps.
export function renderColor(hex, durSec, outPath) {
  ffmpeg(["-f", "lavfi", "-i", `color=c=${hex}:s=1920x1080:r=30000/1001:d=${durSec.toFixed(3)}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", outPath]);
}

// Mix a music track into an existing rendered video. musicStartSec trims the
// leading audio so the first detected downbeat lands on the video's t=0.
// mix=true blends with the existing audio (music dipped to musicLevel, clip
// audio kept at full); mix=false replaces the audio entirely with the music.
export function muxMusic(srcPath, musicPath, musicStartSec, mix, musicLevel, outPath) {
  const startArg = ["-ss", Math.max(0, musicStartSec).toFixed(3)];
  if (!mix) {
    ffmpeg([
      "-i", srcPath,
      ...startArg, "-i", musicPath,
      "-map", "0:v", "-map", "1:a",
      "-c:v", "copy",
      "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
      "-shortest", outPath,
    ]);
    return;
  }
  // Mix with automatic dialogue ducking. asplit makes a sidechain key from the
  // Sidechain ducking: clip audio splits into dialogue + key; music ducks
  // against key (broadcast-news preset); amix sums dialogue + ducked music.
  const chain = `[0:a]asplit=2[dry][key];[1:a]volume=${musicLevel.toFixed(3)}[musraw];[musraw][key]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300:makeup=1[ducked];[dry][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[outa]`;
  ffmpeg([
    "-i", srcPath,
    ...startArg, "-i", musicPath,
    "-filter_complex", chain,
    "-map", "0:v", "-map", "[outa]",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-shortest", outPath,
  ]);
}
