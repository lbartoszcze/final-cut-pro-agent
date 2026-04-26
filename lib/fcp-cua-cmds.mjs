// Background-safe Cua-driven command implementations. Each export maps
// to one CLI subcommand registered in fcp.mjs.

import {
  ensureDaemon, getFcp, snapshot, clickIndex, setValue, pressKey,
  typeText, parseIndexedTree, fcpEffect, hotkey, waitForWindow, findWindowId,
} from "./fcp-cua.mjs";

import { execFileSync } from "node:child_process";
function sleep(s) { execFileSync("sleep", [String(s)]); }

export function cuaInit() {
  const state = ensureDaemon();
  const { pid, window_id } = getFcp();
  console.log(JSON.stringify({ daemon: state, pid, window_id }, null, 2));
}

export function cuaSnapshotCmd() {
  ensureDaemon();
  const { pid, window_id } = getFcp();
  console.log(snapshot(pid, window_id));
}

export function cuaClickCmd([idx]) {
  if (!idx) throw new Error("cua-click <element_index>");
  ensureDaemon();
  const { pid, window_id } = getFcp();
  console.log(clickIndex(pid, window_id, parseInt(idx)));
}

export function cuaPlayCmd() {
  ensureDaemon();
  const { pid } = getFcp();
  pressKey(pid, "space");
  console.log("toggled play");
}

export function cuaStopCmd() {
  ensureDaemon();
  const { pid } = getFcp();
  pressKey(pid, "space");
}

export function cuaPressCmd([key]) {
  if (!key) throw new Error("cua-press <key>");
  ensureDaemon();
  const { pid } = getFcp();
  console.log(pressKey(pid, key));
}

export function cuaTypeCmd(args) {
  const text = args.join(" ");
  if (!text) throw new Error("cua-type <text>");
  ensureDaemon();
  const { pid } = getFcp();
  console.log(typeText(pid, text));
}

export function cuaFindCmd(args) {
  const label = args.join(" ");
  if (!label) throw new Error("cua-find <label>");
  ensureDaemon();
  const { pid, window_id } = getFcp();
  const items = parseIndexedTree(snapshot(pid, window_id));
  const hits = items.filter((i) => i.label.toLowerCase().includes(label.toLowerCase()));
  console.log(JSON.stringify(hits, null, 2));
}

// Apply an effect from the Effects browser to whatever clip is selected.
export function cuaEffect([effectName]) {
  if (!effectName) throw new Error("cua-effect <effect-name>");
  ensureDaemon();
  const { pid, window_id } = getFcp();
  console.log(fcpEffect(pid, window_id, effectName));
}

// Apply a built-in color preset by walking the Inspector. Operates on the
// currently selected timeline clip — caller is expected to select first.
export function cuaColorPreset([presetName]) {
  if (!presetName) throw new Error("cua-color-preset <preset>");
  ensureDaemon();
  const { pid, window_id } = getFcp();
  hotkey(pid, ["cmd", "6"]); // open Color Inspector
  sleep(0.4);
  const tree = snapshot(pid, window_id);
  const re = new RegExp(`\\[(\\d+)\\] AXStaticText = "${presetName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}"`);
  const m = tree.match(re);
  if (!m) throw new Error(`preset "${presetName}" not found in Color Inspector`);
  clickIndex(pid, window_id, parseInt(m[1]));
  sleep(0.3);
  console.log(`applied color preset ${presetName}`);
}

// Add a title at the playhead position. Searches the Titles browser
// (cmd-shift-1), picks the requested template, then double-clicks to insert.
export function cuaTitle([titleType, ...rest]) {
  const tpl = titleType || "Basic Title";
  const text = rest.join(" ");
  ensureDaemon();
  const { pid, window_id } = getFcp();
  hotkey(pid, ["cmd", "shift", "1"]); // Titles browser
  sleep(0.5);
  let tree = snapshot(pid, window_id);
  const re = new RegExp(`\\[(\\d+)\\] AXStaticText = "${tpl.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}"`);
  const m = tree.match(re);
  if (!m) throw new Error(`title template "${tpl}" not found`);
  // Use the cua double_click verb so it lands on the timeline at the playhead.
  // (call() lives in the wrapper; reuse via clickIndex with action "pick"
  // when the daemon supports double-press; otherwise emulate.)
  clickIndex(pid, window_id, parseInt(m[1]), "pick");
  sleep(0.5);
  if (text) {
    typeText(pid, text);
    sleep(0.2);
  }
  console.log(`inserted title ${tpl}`);
}

export function cuaUndo() {
  ensureDaemon();
  const { pid } = getFcp();
  hotkey(pid, ["cmd", "z"]);
  console.log("undo");
}

export function cuaRedo() {
  ensureDaemon();
  const { pid } = getFcp();
  hotkey(pid, ["cmd", "shift", "z"]);
  console.log("redo");
}

// Cmd-E opens Share. Pick the requested destination, click Next, then Save
// using the supplied filename. Output lands in ~/Movies by default.
export function cuaShare([destination, filename]) {
  const dest = destination || "Master File";
  const name = filename || "fcp-agent-export";
  ensureDaemon();
  const { pid } = getFcp();
  hotkey(pid, ["cmd", "e"]);
  const shareWin = waitForWindow(pid, "Share");
  sleep(0.4);
  let tree = snapshot(pid, shareWin);
  const destRe = new RegExp(`\\[(\\d+)\\] AXStaticText = "${dest.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}"`);
  const dm = tree.match(destRe);
  if (dm) {
    clickIndex(pid, shareWin, parseInt(dm[1]));
    sleep(0.3);
  }
  const nextRe = /\[(\d+)\] AXButton "Next"/;
  const nm = tree.match(nextRe);
  if (nm) {
    clickIndex(pid, shareWin, parseInt(nm[1]));
    sleep(0.6);
  }
  const saveWin = waitForWindow(pid, "Share");
  tree = snapshot(pid, saveWin);
  const nameIdx = tree.match(/\[(\d+)\] AXTextField[^\n]*saveAsNameTextField/);
  const saveBtnIdx = tree.match(/\[(\d+)\] AXButton "Save"/);
  if (nameIdx) setValue(pid, saveWin, parseInt(nameIdx[1]), name);
  sleep(0.2);
  if (saveBtnIdx) clickIndex(pid, saveWin, parseInt(saveBtnIdx[1]));
  sleep(1.0);
  console.log(`Share queued: ~/Movies/${name}.mov (or destination default)`);
}

// Same flow as cuaShare but pinned to "Master File" with H.264 default.
export function cuaExport([filename]) {
  return cuaShare(["Master File", filename]);
}
