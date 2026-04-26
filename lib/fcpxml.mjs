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
export function asset({ id, name, src, durFrames, rateNum, rateDen, hasVideo = "1", hasAudio = "1", videoSources = "1", audioSources = "1", audioChannels = "2", audioRate = "48000" }) {
  return `<asset id="${id}" name="${esc(name)}" start="0s" duration="${rt(durFrames, rateNum, rateDen)}" hasVideo="${hasVideo}" format="r1" hasAudio="${hasAudio}" videoSources="${videoSources}" audioSources="${audioSources}" audioChannels="${audioChannels}" audioRate="${audioRate}"><media-rep kind="original-media" src="file://${esc(src)}"/></asset>`;
}

// Format declaration. r1 is the project sequence format; per-asset formats are
// inferred by FCP when only the sequence format is named.
export function format({ id, name, frameDuration, width, height, colorSpace = "1-1-1 (Rec. 709)" }) {
  return `<format id="${id}" name="${esc(name)}" frameDuration="${frameDuration}" width="${width}" height="${height}" colorSpace="${colorSpace}"/>`;
}

// Single timeline clip referencing an asset. offset = position on timeline,
// start = in-point inside the asset, duration = how long it plays.
export function assetClip({ name, ref, offsetFrames, startFrames, durFrames, rateNum, rateDen, lane = "0", children = "" }) {
  const lAttr = lane === "0" ? "" : ` lane="${lane}"`;
  return `<asset-clip name="${esc(name)}" offset="${rt(offsetFrames, rateNum, rateDen)}" ref="${ref}" start="${rt(startFrames, rateNum, rateDen)}" duration="${rt(durFrames, rateNum, rateDen)}" tcFormat="NDF"${lAttr}>${children}</asset-clip>`;
}

// Gap fills empty timeline space (used during intro before first clip lands).
export function gap({ offsetFrames, durFrames, rateNum, rateDen, children = "" }) {
  return `<gap name="Gap" offset="${rt(offsetFrames, rateNum, rateDen)}" start="0s" duration="${rt(durFrames, rateNum, rateDen)}">${children}</gap>`;
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

// Wraps timeline children in a project + sequence + spine.
export function document({ formatNode, eventName, projectName, sequenceFormat, durFrames, rateNum, rateDen, assetsXml, spineXml }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.13">
  <resources>
    ${formatNode}
    <effect id="r2" name="Cross Dissolve" uid=".../Transitions.localized/Dissolves.localized/Cross Dissolve.localized/Cross Dissolve.motn"/>
    <effect id="r3" name="Basic Title" uid=".../Titles.localized/Basic Text.localized/Basic Title.localized/Basic Title.motn"/>
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
