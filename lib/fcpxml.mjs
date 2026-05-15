// FCPXML 1.13 primitives. Pure string emitters. Used by make-cut.mjs.

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Final Cut uses rational time strings: "<frames>/<rate>s". 30000/1001 NTSC.
export function rt(frames, rateNum = 30000, rateDen = 1001) {
  const ticks = frames * rateDen;
  return `${ticks}/${rateNum}s`;
}

// One asset per source file. id is referenced by asset-clip ref attribute.
// Asset declaration with absolute file:// URL. FCP uses the src URL to
// re-locate media; URL-encoding the path lets sources with spaces / unicode
// import cleanly without a manual "find file" prompt.
export function asset({ id, name, src, durFrames, rateNum, rateDen, hasVideo = "1", hasAudio = "1", videoSources = "1", audioSources = "1", audioChannels = "2", audioRate = "48000" }) {
  if (!src.startsWith("/")) throw new Error(`asset src must be absolute: ${src}`);
  const url = "file://" + src.split("/").map((seg) => seg ? encodeURIComponent(seg) : "").join("/");
  return `<asset id="${id}" name="${esc(name)}" start="0s" duration="${rt(durFrames, rateNum, rateDen)}" hasVideo="${hasVideo}" format="r1" hasAudio="${hasAudio}" videoSources="${videoSources}" audioSources="${audioSources}" audioChannels="${audioChannels}" audioRate="${audioRate}"><media-rep kind="original-media" src="${url}"/></asset>`;
}

// Format declaration. r1 is the project sequence format; per-asset formats are
// inferred by FCP when only the sequence format is named.
export function format({ id, name, frameDuration, width, height, colorSpace = "1-1-1 (Rec. 709)" }) {
  return `<format id="${id}" name="${esc(name)}" frameDuration="${frameDuration}" width="${width}" height="${height}" colorSpace="${colorSpace}"/>`;
}

// Single timeline clip referencing an asset. offset = position on timeline,
// start = in-point inside the asset, duration = how long it plays. Optional
// `role` (e.g. dialogue / music / effects) lets FCP stem-export by role; the
// `keywords` array emits one <keyword> child per tag for smart-collection
// filtering in FCP.
export function assetClip(opts) {
  const lane = opts.lane || "0";
  const lAttr = lane === "0" ? "" : ` lane="${lane}"`;
  const rAttr = opts.role ? ` role="${opts.role}"` : "";
  const kwXml = (opts.keywords && opts.keywords.length > 0)
    ? `<keyword start="${rt(opts.startFrames, opts.rateNum, opts.rateDen)}" duration="${rt(opts.durFrames, opts.rateNum, opts.rateDen)}" value="${esc(opts.keywords.join(", "))}"/>`
    : "";
  const children = (opts.children || "") + kwXml;
  return `<asset-clip name="${esc(opts.name)}" offset="${rt(opts.offsetFrames, opts.rateNum, opts.rateDen)}" ref="${opts.ref}" start="${rt(opts.startFrames, opts.rateNum, opts.rateDen)}" duration="${rt(opts.durFrames, opts.rateNum, opts.rateDen)}" tcFormat="NDF"${lAttr}${rAttr}>${children}</asset-clip>`;
}

// Gap fills empty timeline space (used during intro before first clip lands).
export function gap({ offsetFrames, durFrames, rateNum, rateDen, children = "" }) {
  return `<gap name="Gap" offset="${rt(offsetFrames, rateNum, rateDen)}" start="0s" duration="${rt(durFrames, rateNum, rateDen)}">${children}</gap>`;
}

// Compound-clip definition + reference. A `<media>` block in <resources>
// declares a reusable mini-sequence; `<ref-clip>` on the timeline plays it.
// Used for repeating chorus / verse sections so long timelines stay compact.
export function compoundMedia(id, name, durFrames, rateNum, rateDen, spineXml) {
  const dur = rt(durFrames, rateNum, rateDen);
  return `<media id="${id}" name="${esc(name)}"><sequence duration="${dur}" tcStart="0s" tcFormat="NDF"><spine>${spineXml}</spine></sequence></media>`;
}
export function refClip(opts) {
  const lane = opts.lane || "0";
  const lAttr = lane === "0" ? "" : ` lane="${lane}"`;
  return `<ref-clip name="${esc(opts.name)}" ref="${opts.ref}" offset="${rt(opts.offsetFrames, opts.rateNum, opts.rateDen)}" duration="${rt(opts.durFrames, opts.rateNum, opts.rateDen)}"${lAttr}/>`;
}

// sync-clip wraps a camera asset + its external-audio sibling into a single
// FCP synced-clip element. videoRef + audioRef are the asset ids registered
// in <resources>. Audio rides on the negative-lane "-1" so it imports
// pre-synced.
export function syncClip(opts) {
  const lane = opts.lane || "0";
  const lAttr = lane === "0" ? "" : ` lane="${lane}"`;
  const startA = rt(opts.startFrames, opts.rateNum, opts.rateDen);
  const dur = rt(opts.durFrames, opts.rateNum, opts.rateDen);
  return `<sync-clip name="${esc(opts.name)}" offset="${rt(opts.offsetFrames, opts.rateNum, opts.rateDen)}" duration="${dur}" start="${startA}" tcFormat="NDF"${lAttr}><asset-clip ref="${opts.videoRef}" name="${esc(opts.name)}-v" offset="${startA}" duration="${dur}" start="${startA}"/><asset-clip ref="${opts.audioRef}" name="${esc(opts.name)}-a" lane="-1" offset="${startA}" duration="${dur}" start="${startA}" audioRole="dialogue"/></sync-clip>`;
}

// Marker (generic timeline annotation) and chapter-marker (YouTube/Apple
// chapters export). Both anchor at a `start` offset INSIDE the parent
// clip's local time, with `duration` typically 1 frame. When chaptered,
// FCP exports these as ITT chapter markers in Share / Export.
// Parse "--custom-markers" spec "t1:lbl1,t2:lbl2,..." into [{sec, label}].
export function parseCustomMarkers(spec) {
  if (!spec) return [];
  return spec.split(",").map((s) => { const i = s.indexOf(":"); if (i < 0) return null; const sec = parseFloat(s.slice(0, i)); const label = s.slice(i + 1).trim(); return Number.isFinite(sec) && label ? { sec, label } : null; }).filter(Boolean);
}

// For every unconsumed custom marker, emit a 1-frame gap on the spine so
// FCP still sees the marker at the right timeline position. Used after the
// per-cut emission pass to catch markers that fell into gaps.
export function emitOrphanMarkers(customMarkers, emittedSet, rateNum, rateDen, fps) {
  let out = "";
  for (let i = 0; i < customMarkers.length; i++) {
    if (emittedSet.has(i)) continue;
    const m = customMarkers[i];
    out += gap({ offsetFrames: Math.round(m.sec * fps), durFrames: 1, rateNum, rateDen, children: marker({ startSec: 0, value: m.label, kind: "marker", rateNum, rateDen }) });
    emittedSet.add(i);
  }
  return out;
}

// For each unconsumed custom marker that falls within this cut's timeline
// window, emit a <marker> child anchored inside the source clip.
export function emitCustomMarkers(customMarkers, emittedSet, offsetFrames, startFrames, durFrames, rateNum, rateDen, fps) {
  let out = "";
  const t0 = offsetFrames / fps, t1 = (offsetFrames + durFrames) / fps;
  for (let i = 0; i < customMarkers.length; i++) {
    if (emittedSet.has(i)) continue;
    const m = customMarkers[i];
    if (m.sec >= t0 && m.sec < t1) {
      out += marker({ startSec: startFrames / fps + (m.sec - t0), value: m.label, kind: "marker", rateNum, rateDen });
      emittedSet.add(i);
    }
  }
  return out;
}

export function marker({ startSec, durSec = 0.04, value, kind = "marker", rateNum, rateDen }) {
  const start = `${Math.round(startSec * rateNum)}/${rateNum}s`;
  const dur = `${Math.round(Math.max(durSec, 1 / 30) * rateNum)}/${rateNum}s`;
  if (kind === "chapter-marker") {
    return `<chapter-marker start="${start}" duration="${dur}" value="${esc(value)}" posterOffset="0s"/>`;
  }
  return `<marker start="${start}" duration="${dur}" value="${esc(value)}"/>`;
}

// Per-clip volume adjustment. amount is in dB. Combined with optional
// fadeIn/fadeOut audio-fade primitives, this is the basic unit of audio
// shaping per clip. Stacks with template-mode children.
export function adjustVolume({ amountDB = 0, fadeInSec = 0, fadeOutSec = 0, durSec = 0 }) {
  // FCP's <adjust-volume amount="N dB"> accepts a dB string; param "amount"
  // can carry fadeIn / fadeOut children for in/out fades.
  let inner = "";
  if (fadeInSec > 0) {
    inner += `<param name="amount"><fadeIn type="linear" duration="${fadeInSec.toFixed(3)}s"/></param>`;
  }
  if (fadeOutSec > 0 && durSec > 0) {
    const fadeStart = Math.max(0, durSec - fadeOutSec);
    inner += `<param name="amount" start="${fadeStart.toFixed(3)}s"><fadeOut type="linear" duration="${fadeOutSec.toFixed(3)}s"/></param>`;
  }
  return `<adjust-volume amount="${amountDB.toFixed(2)} dB">${inner}</adjust-volume>`;
}

// Cross-dissolve transition between two adjacent clips. Length is the OVERLAP
// duration; the renderer trims both neighbours by half this length.
export function transition({ name = "Cross Dissolve", offsetFrames, durFrames, rateNum, rateDen }) {
  return `<transition name="${esc(name)}" offset="${rt(offsetFrames, rateNum, rateDen)}" duration="${rt(durFrames, rateNum, rateDen)}"><filter-video ref="r2" name="Cross Dissolve"/></transition>`;
}

// Lower-third style title overlay. Lane > 0 means it floats on top of clips.
export function title({ name = "Basic Title", offsetFrames, durFrames, rateNum, rateDen, text, lane = "1" }) {
  return `<title name="${esc(name)}" lane="${lane}" offset="${rt(offsetFrames, rateNum, rateDen)}" ref="r3" duration="${rt(durFrames, rateNum, rateDen)}" start="${rt(0, rateNum, rateDen)}"><text><text-style ref="ts1">${esc(text)}</text-style></text><text-style-def id="ts1"><text-style font="Helvetica" fontSize="72" fontFace="Bold" fontColor="1 1 1 1" alignment="center"/></text-style-def></title>`;
}

const DEFAULT_EFFECTS = `<effect id="r2" name="Cross Dissolve" uid=".../Transitions.localized/Dissolves.localized/Cross Dissolve.localized/Cross Dissolve.motn"/>
    <effect id="r3" name="Basic Title" uid=".../Titles.localized/Basic Text.localized/Basic Title.localized/Basic Title.motn"/>`;

// Wraps timeline children in a project + sequence + spine.
// effectsXml: explicit `<effect ... />` declarations. When omitted, the two
// default effects (Cross Dissolve + Basic Title) used by cadence-mode are
// emitted. Template mode passes the reference's own effect declarations so
// per-clip filter-video / adjust-* references resolve.
export function document({ formatNode, eventName, projectName, sequenceFormat, durFrames, rateNum, rateDen, assetsXml, spineXml, effectsXml }) {
  const fx = effectsXml || DEFAULT_EFFECTS;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.13">
  <resources>
    ${formatNode}
    ${fx}
    ${assetsXml}
  </resources>
  <library>
    <event name="${esc(eventName)}">
      <project name="${esc(projectName)}">
        <sequence format="${sequenceFormat}" duration="${rt(durFrames, rateNum, rateDen)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
            ${spineXml}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}
