#!/usr/bin/env node
// CLI wrapper around the non-capturing Final Cut Pro AX driver.
//
// Every command here dispatches into Final Cut Pro via osascript Accessibility
// actions only — no cliclick, no keystroke-to-frontmost, no AXRaise/activate,
// no screenshots. The user's cursor, keyboard, screen, and frontmost window
// are not touched.
//
// macOS will prompt once for Accessibility + Automation permission for
// "Final Cut Pro" and "System Events" the first time the controlling terminal
// runs any of these. Grant it in Settings → Privacy & Security → Accessibility
// and ... → Automation. After that the actions are silent.

import { isRunning, launchBackground, openFile, clickMenu, findInTree, setTextField, pressByLabel } from "../lib/fcp-ax.mjs";

function sleep(sec) { return new Promise((r) => setTimeout(r, sec * 1000)); }

const CMD = {
  // Read-only / launch
  running() { console.log(isRunning() ? "yes" : "no"); },
  launch() { launchBackground(); console.log("launched (background)"); },
  open([file]) {
    if (!file) throw new Error("open <path>");
    openFile(file);
    console.log(`opened ${file}`);
  },
  find([needle]) {
    if (!needle) throw new Error("find <substring>");
    process.stdout.write(findInTree(needle));
  },
  // Generic menu click: `cut fcp menu File Save`, `cut fcp menu File Share "Master File…"`
  menu(args) {
    if (args.length < 2) throw new Error('menu <top> [<submenu>...] <leaf>   e.g. menu File Save');
    clickMenu(args);
    console.log(`menu: ${args.join(" → ")}`);
  },
  // Canonical actions, all via menu — never keystroke-to-frontmost.
  // FCP libraries auto-save; there is no Save Project menu item. Use
  // close-library / close-timeline / undo / redo for real menu commands.
  "close-library"() { clickMenu(["File", "Close Library"]); console.log("library closed"); },
  "close-timeline"() { clickMenu(["File", "Close Timeline"]); console.log("timeline closed"); },
  undo() { clickMenu(["Edit", "Undo"]); console.log("undo"); },
  redo() { clickMenu(["Edit", "Redo"]); console.log("redo"); },

  // Apply an effect to the selected timeline clip via menu + AX.
  //   1. Open Effects browser via Window menu.
  //   2. Set the search field's value (no keystrokes).
  //   3. AXPress the row whose label matches.
  async "apply-effect"([name]) {
    if (!name) throw new Error("apply-effect <effect-name>");
    if (!isRunning()) throw new Error("Final Cut Pro is not running. `cut fcp launch` first.");
    clickMenu(["Window", "Show in Workspace", "Effects"]);
    await sleep(0.4);
    setTextField("Search", name);
    await sleep(0.4);
    pressByLabel(name);
    console.log(`applied effect: ${name}`);
  },

  // Share via File → Share → <preset>. Verified default in current FCP
  // (queried Window > Show in Workspace and File > Share submenu live).
  async share([preset = "Export File (default)…"]) {
    if (!isRunning()) throw new Error("Final Cut Pro is not running. `cut fcp launch` first.");
    clickMenu(["File", "Share", preset]);
    console.log(`share invoked: ${preset}`);
  },

  help() { printHelp(); },
};

function printHelp() {
  console.log("cut fcp — non-capturing Final Cut Pro driver");
  console.log("");
  console.log("Every command dispatches via macOS Accessibility actions only.");
  console.log("No cursor warp, no keystroke-to-frontmost, no screen capture,");
  console.log("no focus-stealing activate — Final Cut Pro can stay backgrounded.");
  console.log("");
  console.log("Commands:");
  console.log("  cut fcp running                    is Final Cut Pro running?");
  console.log("  cut fcp launch                     launch FCP in the background (-g)");
  console.log("  cut fcp open <path>                open a project / .fcpxml (background)");
  console.log("  cut fcp menu <top> [...] <leaf>    click any menu item, e.g. menu Edit Undo");
  console.log("  cut fcp close-library              File → Close Library");
  console.log("  cut fcp close-timeline             File → Close Timeline");
  console.log("  cut fcp undo / redo                Edit → Undo / Redo");
  console.log("  cut fcp apply-effect <name>        apply effect to selected timeline clip");
  console.log("  cut fcp share [<preset>]           File → Share → preset (default 'Export File (default)…')");
  console.log("  cut fcp find <substring>           dump AX-tree matches (debugging)");
  console.log("");
  console.log("First-time use: grant Accessibility + Automation permission for");
  console.log("Final Cut Pro + System Events to this terminal in Settings.");
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "-h" || cmd === "--help") { printHelp(); process.exit(0); }
if (!CMD[cmd]) { console.error(`unknown subcommand: ${cmd}. 'cut fcp help' for list.`); process.exit(2); }
try {
  const r = CMD[cmd](rest);
  if (r && typeof r.then === "function") r.catch((e) => { console.error(e.message); process.exit(1); });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
