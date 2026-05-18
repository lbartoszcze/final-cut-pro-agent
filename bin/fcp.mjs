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
import { getAttr, setAttr, performAction, selectElement, dialogPress, dialogSetField, dumpTree, listMenus } from "../lib/fcp-ax-generic.mjs";
import { WRAPPERS, WRAPPERS_HELP } from "../lib/fcp-wrappers.mjs";
import { INSPECTOR, INSPECTOR_HELP } from "../lib/fcp/inspector.mjs";

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

  // Universal AX primitives — reach any element FCP exposes.
  "ax-get"([attr, ...rest]) {
    if (!attr || rest.length === 0) throw new Error("ax-get <attr> <needle...>");
    const needle = rest.join(" ");
    process.stdout.write(getAttr(needle, attr));
    process.stdout.write("\n");
  },
  "ax-set"([attr, needleArg, ...valueParts]) {
    if (!attr || !needleArg || valueParts.length === 0) {
      throw new Error("ax-set <attr> <needle> <value>");
    }
    setAttr(needleArg, attr, valueParts.join(" "));
    console.log(`ax-set: ${attr} of "${needleArg}" = "${valueParts.join(" ")}"`);
  },
  "ax-press"([action, ...rest]) {
    if (!action || rest.length === 0) throw new Error("ax-press <action> <needle...>");
    const needle = rest.join(" ");
    performAction(needle, action);
    console.log(`ax-press: ${action} on "${needle}"`);
  },
  select([...rest]) {
    if (rest.length === 0) throw new Error("select <needle...>");
    const needle = rest.join(" ");
    selectElement(needle);
    console.log(`selected: ${needle}`);
  },
  "dialog-button"([...rest]) {
    if (rest.length === 0) throw new Error("dialog-button <label...>");
    const label = rest.join(" ");
    dialogPress(label);
    console.log(`dialog button pressed: ${label}`);
  },
  "dialog-set"([field, ...valueParts]) {
    if (!field || valueParts.length === 0) throw new Error("dialog-set <field> <value>");
    dialogSetField(field, valueParts.join(" "));
    console.log(`dialog field "${field}" set`);
  },
  dump() { process.stdout.write(dumpTree()); },
  menus() { process.stdout.write(listMenus()); },
  wrappers() { printWrappers(); },

  // ---- 197 named wrappers for menu surface + 27 Inspector / Share ops ----
  ...WRAPPERS,
  ...INSPECTOR,

  help() { printHelp(); },
};

function printWrappers() {
  const total = Object.keys(WRAPPERS).length + Object.keys(INSPECTOR).length;
  console.log(`Named wrappers (${total} total):`);
  for (const [group, names] of [...WRAPPERS_HELP, ...INSPECTOR_HELP]) {
    console.log(`  ${group}:`);
    let line = "    ";
    for (const n of names) {
      if (line.length + n.length > 78) { console.log(line); line = "    "; }
      line += n + "  ";
    }
    if (line.trim().length) console.log(line);
  }
}

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
  console.log("  cut fcp dump                       dump every element of window 1 (role | desc | value)");
  console.log("  cut fcp menus                      catalog every menu-bar-reachable FCP command");
  console.log("  cut fcp wrappers                   list 153 named-wrapper commands by group");
  console.log("");
  console.log("Universal AX primitives — reach any element (Inspector, dialog, etc):");
  console.log("  cut fcp ax-get <attr> <needle>     read AX attribute (e.g. AXValue, AXSize, AXEnabled)");
  console.log("  cut fcp ax-set <attr> <needle> <v> write AX attribute (slider value, popup choice)");
  console.log("  cut fcp ax-press <action> <needle> perform AX action (AXPress, AXIncrement, AXShowMenu)");
  console.log("  cut fcp select <needle>            `select` a selectable element (clip, row, item)");
  console.log("  cut fcp dialog-button <label>      press a button in the topmost modal sheet");
  console.log("  cut fcp dialog-set <field> <val>   set a text field in the topmost modal sheet");
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
