// Browser-driven catalog apply commands + state readers for the FCP driver.
//
// apply-title / apply-transition / apply-generator parallel the existing
// apply-effect command (which lives in bin/fcp.mjs CMD). Each opens the
// relevant browser panel, types a name into the Search field, and presses
// the matching catalog row to apply to the selected timeline clip.
//
// Status readers (status, frontmost, playhead, clip-info) query FCP's AX
// tree non-destructively.
//
// Same non-capturing contract: osascript AX actions on Final Cut Pro only.
// No cursor, no keystrokes, no screencapture.

import { clickMenu, isRunning, setTextField, pressByLabel, osa } from "../fcp-ax.mjs";
import { getAttr } from "../fcp-ax-generic.mjs";

// Read a process-level AX attribute (AXFrontmost, AXHidden, AXMenuBar) on
// the Final Cut Pro process itself — not on any of its windows.
function processAttr(attr) {
  return osa(`tell application "System Events" to return (value of attribute "${attr}" of process "Final Cut Pro") as text`);
}

function need() {
  if (!isRunning()) throw new Error("Final Cut Pro is not running. `cut fcp launch` first.");
}

const sleep = (sec) => new Promise((r) => setTimeout(r, sec * 1000));

// Generic apply-from-catalog helper. Opens the named panel via menu, types
// into the search field, then AXPresses the matching row.
async function applyFromCatalog(panelMenu, name) {
  if (!name) throw new Error("apply-* <name>");
  need();
  clickMenu(panelMenu);
  await sleep(0.4);
  setTextField("Search", name);
  await sleep(0.5);
  pressByLabel(name);
  console.log(`applied: ${name}`);
}

export const APPLY = {
  // Apply a transition by name to the currently-selected timeline edit point.
  async "apply-transition"([name]) {
    await applyFromCatalog(["Window", "Show in Workspace", "Transitions"], name);
  },
  // Apply a title from the Titles & Generators browser.
  async "apply-title"([name]) {
    await applyFromCatalog(["Window", "Go To", "Titles and Generators"], name);
  },
  // Apply a generator (background, shape, placeholder). Same browser pane as
  // Titles in FCP — Generators is a sibling tab under Titles and Generators.
  async "apply-generator"([name]) {
    await applyFromCatalog(["Window", "Go To", "Titles and Generators"], name);
  },

  // FCP frontmost state via process-level AX query.
  frontmost() {
    need();
    console.log(processAttr("AXFrontmost"));
  },
  // Process visibility (hidden vs visible). False = hidden / backgrounded.
  visible() {
    need();
    console.log(processAttr("AXHidden") === "true" ? "false" : "true");
  },
  // Project timecode display in the viewer toolbar (AXDescription matches the
  // "Project Timecode" menu item in Window menu).
  playhead() {
    need();
    console.log(getAttr("Project Timecode", "AXValue"));
  },
  // Inspector "Name" field for the currently-selected clip. Errors if nothing
  // is selected — use `inspect-find Name` to inspect the live tree.
  "clip-info"() {
    need();
    clickMenu(["Window", "Go To", "Inspector"]);
    console.log(`name: ${getAttr("Name", "AXValue")}`);
  },
  // Compact status snapshot.
  status() {
    if (!isRunning()) { console.log("running: no"); return; }
    console.log("running: yes");
    try { console.log(`frontmost: ${processAttr("AXFrontmost")}`); } catch (_) {}
    try { console.log(`hidden:    ${processAttr("AXHidden")}`); } catch (_) {}
  },
};

export const APPLY_HELP = [
  ["Apply / catalog", ["apply-transition <name>", "apply-title <name>", "apply-generator <name>"]],
  ["Status / read",   ["status", "frontmost", "visible", "playhead", "clip-info"]],
];
