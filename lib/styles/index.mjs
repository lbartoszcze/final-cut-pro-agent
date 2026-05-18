// Style-pack registry + loader.
//
// Wires --style=<pack> in bin/make-cut.mjs onto a JSON manifest of FCPXML
// authoring defaults (aspect, fps, look, bpm, bars, audio-target, etc.).
// Each pack is a one-key entry under packs.json :: packs.<name>; the loader
// merges the pack's defaults UNDER the user's explicit CLI flags so any
// individual field remains overridable.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKS = JSON.parse(readFileSync(join(HERE, "packs.json"), "utf8")).packs;

export function listStylePacks() {
  return Object.entries(PACKS).map(([name, pack]) => ({ name, description: pack.description }));
}

export function getStylePack(name) {
  const pack = PACKS[name];
  if (!pack) {
    const known = Object.keys(PACKS).join(", ");
    throw new Error(`unknown --style=${name}. Available: ${known}`);
  }
  return pack;
}

// Merge a named pack's defaults UNDER user-supplied flags. Any key the user
// explicitly passed (present in `userFlags`) wins; only keys absent from
// userFlags inherit from the pack. `userFlags` is the raw `sup` map (only
// keys explicitly passed on the CLI), not the post-default-merge args object.
export function mergeStylePack(name, userFlags) {
  const pack = getStylePack(name);
  const merged = { ...userFlags };
  for (const [k, v] of Object.entries(pack.defaults)) {
    if (!(k in userFlags)) merged[k] = String(v);
  }
  return merged;
}
