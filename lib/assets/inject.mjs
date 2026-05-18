// Bridge: brainrot SFX + Giphy MP4 -> FCPXML <asset> + <asset-clip>.
//
// buildInjections() fetches the requested assets to the .work caches,
// ffprobes each for real duration, and returns { assetsXml, clipsXml }:
//   - assetsXml : extra <asset> declarations for the <resources> block
//   - clipsXml  : <asset-clip> placements (SFX on a dedicated audio lane,
//                 Giphy on a B-roll video lane) at hook / cut offsets
//
// SFX placement rule: one SFX clip per "hook" (offset 0) by default, or
// spread across the timeline if multiple names are given.
// Giphy placement rule: a single B-roll cutaway at the hook window.

import { execFileSync } from "node:child_process";
import { fetchSfx, listSfx } from "../sfx/index.mjs";
import { downloadGif } from "../giphy/index.mjs";
import { asset, assetClip } from "../fcpxml.mjs";

function probeDurSec(path) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1", path,
  ], { encoding: "utf8" }).trim();
  const d = parseFloat(out);
  if (!Number.isFinite(d) || d <= 0) throw new Error(`ffprobe: bad duration for ${path}: ${out}`);
  return d;
}

// sfxSpec: comma list of catalog names, or "all" to lay every cataloged
// SFX end-to-end at the hook. gifQuery: a search string for one B-roll.
export async function buildInjections(opts) {
  const { sfxSpec, gifQuery, hookSec, totalFrames, fps, rateNum, rateDen, assetIdStart } = opts;
  const assets = [];
  const clips = [];
  let id = assetIdStart;

  if (sfxSpec) {
    const names = sfxSpec === "all"
      ? listSfx().map((s) => s.name)
      : sfxSpec.split(",").map((s) => s.trim()).filter(Boolean);
    // Spread SFX evenly across the timeline; the first lands on the hook.
    const span = Math.max(1, totalFrames - 1);
    const resolved = [];
    for (const name of names) {
      const p = await fetchSfx(name);
      resolved.push({ name, path: p, dur: probeDurSec(p) });
    }
    resolved.forEach((r, i) => {
      const aId = `r${id++}`;
      const durF = Math.max(2, Math.round(r.dur * fps));
      const offF = i === 0 ? 0 : Math.round((span / resolved.length) * i);
      assets.push(asset({
        id: aId, name: `sfx-${r.name}`, src: r.path,
        durFrames: durF, rateNum, rateDen,
        hasVideo: "0", videoSources: "0",
      }));
      clips.push(assetClip({
        name: `sfx-${r.name}`, ref: aId,
        offsetFrames: offF, startFrames: 0, durFrames: durF,
        rateNum, rateDen, lane: "-2", role: "effects",
      }));
    });
  }

  if (gifQuery) {
    const p = await downloadGif(gifQuery);
    const dur = probeDurSec(p);
    const aId = `r${id++}`;
    const durF = Math.max(2, Math.round(dur * fps));
    const hookF = Math.max(2, Math.round((hookSec || 3) * fps));
    assets.push(asset({
      id: aId, name: `gif-${gifQuery}`.slice(0, 40), src: p,
      durFrames: durF, rateNum, rateDen,
    }));
    clips.push(assetClip({
      name: `gif-${gifQuery}`.slice(0, 40), ref: aId,
      offsetFrames: 0, startFrames: 0,
      durFrames: Math.min(durF, hookF),
      rateNum, rateDen, lane: "2", role: "video",
    }));
  }

  return {
    assetsXml: assets.join("\n    "),
    clipsXml: clips.join("\n            "),
    nextAssetId: id,
  };
}
