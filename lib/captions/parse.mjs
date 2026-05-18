// SRT + VTT caption-file parser for the FCPXML author.
//
// Reads a .srt or .vtt file (output by Whisper, yt-dlp auto-subs, or any
// standard transcription tool) and returns cues = [{ startSec, endSec, text }].
// lib/fcpxml.mjs::emitCaptions() consumes the cues and emits <caption>
// elements on lane=-1 of the spine.

import { readFileSync } from "node:fs";

// Convert a "HH:MM:SS.mmm" or "HH:MM:SS,mmm" timestamp to seconds.
function parseTimestamp(t) {
  const cleaned = t.replace(",", ".").trim();
  const m = cleaned.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) throw new Error(`bad timestamp: ${t}`);
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = parseFloat(m[3]);
  return h * 3600 + min * 60 + s;
}

// Strip VTT inline markup (<00:00:00.880><c>...</c>) and HTML tags.
function stripMarkup(s) {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

// Parse either VTT or SRT content. The two formats share enough structure
// that one parser handles both — SRT uses "," in timestamps + numeric cue
// IDs, VTT uses "." and may have WEBVTT header lines + inline cue styling.
export function parseCues(content) {
  const lines = content.split(/\r?\n/);
  const cues = [];
  let i = 0;
  // Skip VTT header and any leading blanks / NOTE / STYLE blocks.
  while (i < lines.length && !/-->/.test(lines[i])) i++;
  // Step back one line in case the cue-ID line preceded the timing line.
  while (i < lines.length) {
    if (!/-->/.test(lines[i])) { i++; continue; }
    const timing = lines[i].split("-->");
    if (timing.length !== 2) { i++; continue; }
    const startSec = parseTimestamp(timing[0]);
    // VTT timing line may have positioning info after the end-time; split on space.
    const endSec = parseTimestamp(timing[1].trim().split(/\s+/)[0]);
    i++;
    const textLines = [];
    while (i < lines.length && lines[i].trim() !== "") {
      const cleaned = stripMarkup(lines[i]);
      if (cleaned) textLines.push(cleaned);
      i++;
    }
    if (textLines.length > 0) {
      cues.push({ startSec, endSec, text: textLines.join(" ") });
    }
    while (i < lines.length && lines[i].trim() === "") i++;
  }
  return cues;
}

// Read a caption file and return the parsed cues.
export function readCaptionsFile(path) {
  const ext = path.toLowerCase().slice(path.lastIndexOf("."));
  if (ext !== ".srt" && ext !== ".vtt") {
    throw new Error(`unsupported caption file extension: ${ext} (need .srt or .vtt)`);
  }
  return parseCues(readFileSync(path, "utf8"));
}

// Deduplicate consecutive identical cues (common in YouTube auto-sub VTTs
// where each cue repeats the prior cue's tail). Adjacent cues with the
// same text get merged into one spanning the combined time range.
export function dedupeCues(cues) {
  const out = [];
  for (const cue of cues) {
    const last = out[out.length - 1];
    if (last && last.text === cue.text && Math.abs(last.endSec - cue.startSec) < 0.5) {
      last.endSec = cue.endSec;
    } else {
      out.push({ ...cue });
    }
  }
  return out;
}
