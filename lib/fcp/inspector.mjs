// Inspector setters + complete-Share dialog flow for the FCP driver.
//
// These reach AX elements addressed by AXDescription (Inspector sliders /
// popups / text fields) rather than menu paths. Best-effort AXDescription
// names are based on standard FCP conventions; if a setter fails at runtime
// the user can run `cut fcp inspect-find <substring>` to discover the real
// AXDescription for that parameter in the current FCP version.
//
// Same non-capturing contract as the rest of the driver: osascript AX
// actions on Final Cut Pro only. No cursor, no keystrokes, no screencapture.

import { clickMenu, isRunning, findInTree } from "../fcp-ax.mjs";
import {
  setAttr, getAttr, performAction, dialogPress, dialogSetField,
} from "../fcp-ax-generic.mjs";

function need() {
  if (!isRunning()) throw new Error("Final Cut Pro is not running. `cut fcp launch` first.");
}

// Ensure the Inspector pane is visible + focused before reading/writing
// Inspector AX values. Two menu clicks: Show in Workspace > Inspector toggles
// it open (no-op if already open), then Go To > Inspector focuses it.
function focusInspector() {
  try { clickMenu(["Window", "Show in Workspace", "Inspector"]); } catch (_) {}
  try { clickMenu(["Window", "Go To", "Inspector"]); } catch (_) {}
}

function setVal(axDescription) {
  return ([value]) => {
    if (value == null) throw new Error("requires <value>");
    need();
    focusInspector();
    setAttr(axDescription, "AXValue", String(value));
    console.log(`set ${axDescription} = ${value}`);
  };
}

function getVal(axDescription) {
  return () => {
    need();
    focusInspector();
    process.stdout.write(getAttr(axDescription, "AXValue"));
    process.stdout.write("\n");
  };
}

export const INSPECTOR = {
  // Generic Inspector helpers (work for any parameter once you know the
  // AXDescription).
  "inspect-find"([sub]) {
    if (!sub) throw new Error("inspect-find <substring>");
    need();
    focusInspector();
    process.stdout.write(findInTree(sub));
  },
  "inspect-get"([param]) {
    if (!param) throw new Error("inspect-get <param>");
    need();
    focusInspector();
    process.stdout.write(getAttr(param, "AXValue"));
    process.stdout.write("\n");
  },
  "inspect-set"([param, ...rest]) {
    if (!param || rest.length === 0) throw new Error("inspect-set <param> <value>");
    need();
    focusInspector();
    setAttr(param, "AXValue", rest.join(" "));
    console.log(`inspect-set: ${param} = ${rest.join(" ")}`);
  },
  "inspect-press"([param]) {
    if (!param) throw new Error("inspect-press <param>");
    need();
    focusInspector();
    performAction(param, "AXPress");
    console.log(`inspect-press: ${param}`);
  },
  "inspect-incr"([param]) {
    if (!param) throw new Error("inspect-incr <param>");
    need();
    focusInspector();
    performAction(param, "AXIncrement");
    console.log(`inspect-incr: ${param}`);
  },
  "inspect-decr"([param]) {
    if (!param) throw new Error("inspect-decr <param>");
    need();
    focusInspector();
    performAction(param, "AXDecrement");
    console.log(`inspect-decr: ${param}`);
  },

  // Common Inspector parameter shortcuts (best-effort AXDescription names —
  // verify with `inspect-find` if a setter errors).
  "set-volume": setVal("Volume"),
  "set-opacity": setVal("Opacity"),
  "set-position-x": setVal("Position X"),
  "set-position-y": setVal("Position Y"),
  "set-rotation": setVal("Rotation"),
  "set-scale-all": setVal("Scale (All)"),
  "set-scale-x": setVal("Scale X"),
  "set-scale-y": setVal("Scale Y"),
  "set-anchor-x": setVal("Anchor X"),
  "set-anchor-y": setVal("Anchor Y"),

  "read-volume": getVal("Volume"),
  "read-opacity": getVal("Opacity"),
  "read-position-x": getVal("Position X"),
  "read-position-y": getVal("Position Y"),
  "read-rotation": getVal("Rotation"),
  "read-scale-all": getVal("Scale (All)"),
  "read-scale-x": getVal("Scale X"),
  "read-scale-y": getVal("Scale Y"),
  "read-anchor-x": getVal("Anchor X"),
  "read-anchor-y": getVal("Anchor Y"),

  // Complete Share dialog flow: drives the multi-step Share dialog
  // end-to-end without a mouse:
  //   1. File > Share > <preset>            opens Info pane
  //   2. dialogSetField("Description", ...) fills the master filename
  //   3. dialogPress("Next…")               advances to destination
  //   4. dialogPress("Save")                confirms default destination
  async export([preset, ...filenameParts]) {
    if (!preset || filenameParts.length === 0) {
      throw new Error('export <preset> <filename>   e.g. export "Export File (default)…" "MyCut"');
    }
    const filename = filenameParts.join(" ");
    need();
    clickMenu(["File", "Share", preset]);
    await new Promise((r) => setTimeout(r, 1200));
    try { dialogSetField("Description", filename); } catch (_) {}
    try { dialogSetField("Title", filename); } catch (_) {}
    try { dialogPress("Next…"); } catch (_) { try { dialogPress("Next"); } catch (_) {} }
    await new Promise((r) => setTimeout(r, 1200));
    try { dialogPress("Save"); } catch (_) {}
    console.log(`export: ${preset} -> ${filename}`);
  },
};

export const INSPECTOR_HELP = [
  ["Inspector / generic", ["inspect-find <substr>", "inspect-get <param>", "inspect-set <param> <val>", "inspect-press <param>", "inspect-incr <param>", "inspect-decr <param>"]],
  ["Inspector / set",     ["set-volume <dB>", "set-opacity <pct>", "set-position-x <px>", "set-position-y <px>", "set-rotation <deg>", "set-scale-all <pct>", "set-scale-x <pct>", "set-scale-y <pct>", "set-anchor-x <px>", "set-anchor-y <px>"]],
  ["Inspector / read",    ["read-volume", "read-opacity", "read-position-x", "read-position-y", "read-rotation", "read-scale-all", "read-scale-x", "read-scale-y", "read-anchor-x", "read-anchor-y"]],
  ["Share complete",      ["export <preset> <filename>"]],
];
