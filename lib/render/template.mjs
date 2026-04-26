// FCPXML template parser. Reads a reference fcpxml, extracts its primary-spine
// schedule, and returns a list of {tag, offsetSec, durSec, lane, name, text}
// records that make-cut.mjs and lib/render/video.mjs can use to apply that
// edit's cadence to a different footage folder.

import { readFileSync } from "node:fs";

// FCPXML rational time strings: "<num>/<den>s" or "<sec>s".
function parseRationalSec(rt) {
  if (!rt) return 0;
  const m = rt.match(/(-?\d+)\/(\d+)s/);
  if (m) return parseInt(m[1]) / parseInt(m[2]);
  const m2 = rt.match(/(-?\d+(?:\.\d+)?)s/);
  return m2 ? parseFloat(m2[1]) : 0;
}

// Extracts the FIRST spine. References may have nested spines (compound clips,
// multicam) — we only follow the primary timeline. Counts <spine> opens vs
// </spine> closes so nested ones don't confuse the slice.
function firstSpineBody(xml) {
  const open = xml.indexOf("<spine");
  if (open < 0) return "";
  const bodyStart = xml.indexOf(">", open) + 1;
  let depth = 1, i = bodyStart;
  while (i < xml.length && depth > 0) {
    const nextOpen = xml.indexOf("<spine", i);
    const nextClose = xml.indexOf("</spine>", i);
    if (nextClose < 0) return xml.slice(bodyStart);
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth++;
      i = xml.indexOf(">", nextOpen) + 1;
    } else {
      depth--;
      if (depth === 0) return xml.slice(bodyStart, nextClose);
      i = nextClose + 8;
    }
  }
  return xml.slice(bodyStart);
}

// Parse a reference fcpxml. Returns:
//   { fps, totalSec, cuts: [{tag, offsetSec, durSec, lane, name, text?}] }
// where `cuts` is in spine-order. Title cuts include their text content if it
// fits in a simple <title>...<text-style>...</text-style>...</title> shape.
export function parseTemplate(path) {
  const xml = readFileSync(path, "utf8");

  let fps = 30000 / 1001;
  const fmt = xml.match(/<format[^>]*frameDuration="([^"]+)"/);
  if (fmt) {
    const fd = parseRationalSec(fmt[1]);
    if (fd > 0) fps = 1 / fd;
  }

  let totalSec = 0;
  const seq = xml.match(/<sequence[^>]*duration="([^"]+)"/);
  if (seq) totalSec = parseRationalSec(seq[1]);

  const spine = firstSpineBody(xml);
  const cuts = [];
  // Match any spine-child element whose name we care about. We look at the
  // tag and its first attribute block; whether it self-closes or wraps is
  // irrelevant for cadence extraction.
  const re = /<(asset-clip|clip|video|ref-clip|gap|title|transition)\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(spine))) {
    const tag = m[1];
    const attrs = m[2];
    const offM = attrs.match(/\boffset="([^"]+)"/);
    const durM = attrs.match(/\bduration="([^"]+)"/);
    if (!offM || !durM) continue;
    const laneM = attrs.match(/\blane="(-?\d+)"/);
    const nameM = attrs.match(/\bname="([^"]+)"/);
    const lane = laneM ? parseInt(laneM[1]) : 0;
    // Only follow lane-0 (primary spine) for cadence; lane-N elements are
    // overlays that ride alongside (titles above clips). Keep titles even
    // on positive lanes since they're part of the visible cadence.
    if (lane !== 0 && tag !== "title") continue;
    const cut = {
      tag,
      offsetSec: parseRationalSec(offM[1]),
      durSec: parseRationalSec(durM[1]),
      lane,
      name: nameM ? nameM[1] : "",
    };
    if (tag === "title") {
      // Pull the first <text-style ref="...">TEXT</text-style> inside the
      // matching <title>...</title> wrapper.
      const wrapStart = m.index;
      const wrapEnd = spine.indexOf(`</${tag}>`, wrapStart);
      if (wrapEnd > 0) {
        const body = spine.slice(wrapStart, wrapEnd);
        const txt = body.match(/<text-style[^>]*>([^<]+)<\/text-style>/);
        if (txt) cut.text = decodeXml(txt[1]);
      }
    }
    cuts.push(cut);
  }
  if (!totalSec && cuts.length) {
    const last = cuts.reduce((a, b) => (a.offsetSec + a.durSec > b.offsetSec + b.durSec ? a : b));
    totalSec = last.offsetSec + last.durSec;
  }
  return { fps, totalSec, cuts };
}

function decodeXml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

// Substitute each non-title / non-gap / non-transition cut with one of the
// user's clips, round-robin. Returns a list of resolved cuts ready for FCPXML
// emission or ffmpeg rendering: each clip-bearing cut gets a srcIdx + srcInSec
// chosen so repeated picks of the same source clip don't always start at 0.
export function applyTemplate(template, clipDurations) {
  const out = [];
  let clipIdx = 0;
  for (const cut of template.cuts) {
    if (cut.tag === "title" || cut.tag === "transition" || cut.tag === "gap") {
      out.push({ ...cut, kind: cut.tag });
      continue;
    }
    if (clipDurations.length === 0) continue;
    const srcIdx = clipIdx % clipDurations.length;
    const srcDur = clipDurations[srcIdx] || cut.durSec;
    const headroom = Math.max(0, srcDur - cut.durSec - 0.1);
    const srcInSec = headroom === 0 ? 0 : ((clipIdx * 0.7) % headroom);
    out.push({ ...cut, kind: "clip", srcIdx, srcInSec });
    clipIdx++;
  }
  return out;
}
