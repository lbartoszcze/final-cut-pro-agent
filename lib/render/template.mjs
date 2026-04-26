// FCPXML template parser. Reads a reference fcpxml, extracts its primary-spine
// schedule plus per-clip child elements (filter-video / adjust-* / param /
// keyframeAnimation) and the <effect> resource declarations they reference.
// make-cut.mjs and lib/render/video.mjs use this to apply not just the cadence
// but the COLOR GRADE + audio adjustments + transforms of an existing edit
// onto a different footage folder.

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

// Find the matching close tag for a self-or-wrapping element starting at
// `openStart` (index of the opening "<"). Counts depth so nested same-name
// elements don't confuse the slice. Returns end-index just past close tag,
// or -1 if the element was self-closing.
function matchingClose(xml, tag, openStart) {
  const tagEnd = xml.indexOf(">", openStart);
  if (tagEnd < 0) return -1;
  if (xml[tagEnd - 1] === "/") return tagEnd + 1;
  const openRe = new RegExp(`<${tag}\\b`, "g");
  const closeStr = `</${tag}>`;
  let depth = 1, i = tagEnd + 1;
  while (i < xml.length && depth > 0) {
    openRe.lastIndex = i;
    const nextOpen = openRe.exec(xml);
    const nextClose = xml.indexOf(closeStr, i);
    if (nextClose < 0) return -1;
    if (nextOpen && nextOpen.index < nextClose) {
      depth++;
      i = nextOpen.index + 1;
    } else {
      depth--;
      if (depth === 0) return nextClose + closeStr.length;
      i = nextClose + closeStr.length;
    }
  }
  return -1;
}

// Pull every <effect ...> declaration out of <resources>. Each row:
//   { id, name, uid, raw } — raw is the verbatim XML to copy through.
function extractEffects(xml) {
  const out = [];
  const re = /<effect\b([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const idM = attrs.match(/\bid="([^"]+)"/);
    const nameM = attrs.match(/\bname="([^"]+)"/);
    const uidM = attrs.match(/\buid="([^"]+)"/);
    if (!idM) continue;
    out.push({ id: idM[1], name: nameM ? nameM[1] : "", uid: uidM ? uidM[1] : "", raw: m[0] });
  }
  return out;
}

// Parse a reference fcpxml. Returns:
//   { fps, totalSec, effects, cuts }
// where each `cut` has tag/offsetSec/durSec/lane/name plus, for clip-bearing
// cuts, the verbatim `innerXml` (filter-video + adjust-* + param descendants)
// so the grade + transform + audio adjustments can be carried through.
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

  const effects = extractEffects(xml);
  const spine = firstSpineBody(xml);
  const cuts = [];
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
    if (lane !== 0 && tag !== "title") continue;
    const cut = {
      tag,
      offsetSec: parseRationalSec(offM[1]),
      durSec: parseRationalSec(durM[1]),
      lane,
      name: nameM ? nameM[1] : "",
    };
    // Capture inner XML for clip-bearing cuts (so filter-video / adjust-* /
    // param children carry through to the substituted clip in the output).
    if (tag === "asset-clip" || tag === "clip" || tag === "video" || tag === "ref-clip") {
      const close = matchingClose(spine, tag, m.index);
      if (close > 0) {
        const wrapEnd = spine.lastIndexOf("</" + tag + ">", close);
        const tagEnd = spine.indexOf(">", m.index);
        if (wrapEnd > tagEnd) cut.innerXml = spine.slice(tagEnd + 1, wrapEnd);
        re.lastIndex = close;
      }
    }
    if (tag === "title") {
      const wrapEnd = spine.indexOf("</" + tag + ">", m.index);
      if (wrapEnd > 0) {
        const body = spine.slice(m.index, wrapEnd);
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
  return { fps, totalSec, effects, cuts };
}

function decodeXml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

// Substitute each non-title / non-gap / non-transition cut with one of the
// user's clips, round-robin. Each clip-bearing cut keeps the template's
// innerXml (filter-video / adjust-* / param) so the grade + transform carry
// through to the substituted clip when emitted into the new FCPXML.
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

// Strip child elements that reference the template's own assets (since the
// substituted clip uses a different asset id). Keeps filter-video, adjust-*,
// param, keyframe, keyframeAnimation — drops audio-channel-source whose
// sourceID would not resolve, plus any `ref="r..."` mc-source style refs.
export function sanitizeInnerXml(innerXml) {
  if (!innerXml) return "";
  // Remove audio-channel-source elements (they reference per-asset audio
  // channel layouts that don't apply to the user's clip).
  let cleaned = innerXml.replace(/<audio-channel-source\b[^>]*\/>/g, "");
  cleaned = cleaned.replace(/<audio-channel-source\b[\s\S]*?<\/audio-channel-source>/g, "");
  // Remove mc-source / sync-source (multicam / sync-clip references).
  cleaned = cleaned.replace(/<(mc-source|sync-source)\b[\s\S]*?(?:\/>|<\/\1>)/g, "");
  // Normalize whitespace at edges.
  return cleaned.trim();
}
