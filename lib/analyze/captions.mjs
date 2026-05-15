// Whisper-based transcription. Returns segments on the final-video timeline,
// also writes matching SRT + WebVTT side-files at the user-supplied paths.
//
//   transcribeVideo(videoPath, workDir, opts)
//     opts: { model = "small.en", language = "en", srtOut, vttOut }
//     → [ { start, end, text } ]

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

function fmtTs(sec, sep) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(r).padStart(3, "0")}`;
}

export function segmentsToSRT(segments) {
  return segments.map((s, i) => `${i + 1}\n${fmtTs(s.start, ",")} --> ${fmtTs(s.end, ",")}\n${s.text.trim()}`).join("\n\n") + "\n";
}

export function segmentsToVTT(segments) {
  return "WEBVTT\n\n" + segments.map((s) => `${fmtTs(s.start, ".")} --> ${fmtTs(s.end, ".")}\n${s.text.trim()}`).join("\n\n") + "\n";
}

// iTT (TTML profile Apple FCP imports natively as a caption role). One <p>
// per segment; begin/end are HH:MM:SS.fff.
function ittTs(sec) {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(r).padStart(3, "0")}`;
}
export function segmentsToITT(segments) {
  const body = segments.map((s) => `      <p begin="${ittTs(s.start)}" end="${ittTs(s.end)}" region="bottom">${s.text.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xml:lang="en" ttp:timeBase="media" ttp:frameRate="30" ttp:frameRateMultiplier="1000 1001">
  <head>
    <styling>
      <style xml:id="s1" tts:fontFamily="sansSerif" tts:fontSize="80%" tts:color="white" tts:backgroundColor="black"/>
    </styling>
    <layout>
      <region xml:id="bottom" tts:origin="10% 80%" tts:extent="80% 20%" tts:displayAlign="after"/>
    </layout>
  </head>
  <body region="bottom" style="s1">
    <div>
${body}
    </div>
  </body>
</tt>
`;
}

// Naive speaker diarization: tag each consecutive segment with a cyclic
// speaker label A/B/.../N. Heuristic — flips speaker on every silence gap
// >= 1s (whisper segment-end → next-start). Replaces the segment text in
// place: "Hello world." → "[Speaker A] Hello world."
export function applySpeakerLabels(segments, n) {
  if (!segments || segments.length === 0) return segments;
  const labels = "ABCDEFGHIJ".slice(0, Math.max(1, Math.min(10, n)));
  let cur = 0;
  for (let i = 0; i < segments.length; i++) {
    if (i > 0 && segments[i].start - segments[i - 1].end >= 1.0) cur = (cur + 1) % labels.length;
    segments[i].text = `[Speaker ${labels[cur]}] ${segments[i].text}`;
  }
  return segments;
}

export function transcribeVideo(videoPath, workDir, opts) {
  const model = (opts && opts.model) || "small.en";
  const lang = (opts && opts.language) || "en";
  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });
  const base = basename(videoPath).replace(/\.[^.]+$/, "");
  const wav = join(workDir, `${base}-mono16k.wav`);
  const ex = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", wav], { encoding: "utf8" });
  if (ex.status !== 0) throw new Error("ffmpeg wav extract failed:\n" + (ex.stderr || "").slice(-1000));
  const wr = spawnSync("whisper", [wav, "--model", model, "--language", lang, "--output_format", "json", "--output_dir", workDir, "--task", "transcribe", "--fp16", "False"], { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
  if (wr.status !== 0) throw new Error("whisper failed:\n" + (wr.stderr || "").slice(-2000));
  const jsonPath = join(workDir, `${base}-mono16k.json`);
  const j = JSON.parse(readFileSync(jsonPath, "utf8"));
  let segments = (j.segments || []).map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
  if (opts && opts.speakerLabels) segments = applySpeakerLabels(segments, parseInt(opts.speakerLabels) || 2);
  if (opts && opts.srtOut) writeFileSync(opts.srtOut, segmentsToSRT(segments));
  if (opts && opts.vttOut) writeFileSync(opts.vttOut, segmentsToVTT(segments));
  if (opts && opts.ittOut) writeFileSync(opts.ittOut, segmentsToITT(segments));
  return segments;
}
