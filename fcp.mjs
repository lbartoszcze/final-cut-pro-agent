#!/usr/bin/env node
// fcp.mjs - Final Cut Pro automation CLI. Two backends:
//   AX + cliclick  (raises FCP):
//     open, clips, events, projects, select-event, play, stop, in, out,
//     blade, swap-effect, undo, redo
//   cua-driver     (FCP stays backgrounded):
//     cua-init, cua-snapshot, cua-click, cua-play, cua-stop, cua-press,
//     cua-type, cua-find, cua-effect, cua-color-preset, cua-title,
//     cua-share, cua-export, cua-undo, cua-redo

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  activate, listClips, listEvents, listProjects, selectEvent,
  listTimelineClips, keystroke, keyCode, setEffectSearch, findEffectRow,
  doubleClick, sleep,
} from "./lib/fcp-ax.mjs";
import {
  cuaInit, cuaSnapshotCmd, cuaClickCmd, cuaPlayCmd, cuaStopCmd,
  cuaPressCmd, cuaTypeCmd, cuaFindCmd, cuaEffect, cuaColorPreset,
  cuaTitle, cuaShare, cuaExport, cuaUndo, cuaRedo,
} from "./lib/fcp-cua-cmds.mjs";

const CMD = {
  open([file]) {
    if (!file) throw new Error("open <path>");
    execFileSync("open", ["-a", "Final Cut Pro", resolve(file)]);
  },
  clips() { console.log(JSON.stringify(listClips(), null, 2)); },
  events() { console.log(listEvents()); },
  projects() { console.log(listProjects()); },
  "select-event"([label]) {
    if (!label) throw new Error("select-event <name>");
    selectEvent(label);
  },
  tracks() { console.log(JSON.stringify(listTimelineClips(), null, 2)); },
  play() { activate(); keyCode(49); },          // space
  stop() { activate(); keyCode(49); },
  rewind() { activate(); keystroke("a", ["control"]); }, // jump to start
  in() { activate(); keystroke("i"); },
  out() { activate(); keystroke("o"); },
  blade() { activate(); keystroke("b"); },     // blade tool
  select() { activate(); keystroke("a"); },    // select tool

  "swap-effect"([effectName]) {
    if (!effectName) throw new Error("swap-effect <effect-name>");
    activate();
    keystroke("5", ["command"]);                // open Effects browser
    sleep(0.3);
    setEffectSearch(effectName);
    const coord = findEffectRow(effectName);
    if (coord === "none") throw new Error(`effect not found: ${effectName}`);
    doubleClick(coord);
    sleep(0.6);
    console.log(`applied ${effectName}`);
  },

  undo() { keystroke("z", ["command"]); },
  redo() { keystroke("z", ["command", "shift"]); },

  share() { keystroke("e", ["command"]); },
  export() { keystroke("e", ["command"]); },

  // Cua-backed (background-safe) commands.
  "cua-init":         cuaInit,
  "cua-snapshot":     cuaSnapshotCmd,
  "cua-click":        cuaClickCmd,
  "cua-play":         cuaPlayCmd,
  "cua-stop":         cuaStopCmd,
  "cua-press":        cuaPressCmd,
  "cua-type":         cuaTypeCmd,
  "cua-find":         cuaFindCmd,
  "cua-effect":       cuaEffect,
  "cua-color-preset": cuaColorPreset,
  "cua-title":        cuaTitle,
  "cua-share":        cuaShare,
  "cua-export":       cuaExport,
  "cua-undo":         cuaUndo,
  "cua-redo":         cuaRedo,
};

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || !CMD[cmd]) {
  console.error("Usage: node fcp.mjs <command> [args...]");
  console.error("Commands: " + Object.keys(CMD).join(", "));
  process.exit(1);
}
try {
  CMD[cmd](rest);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
