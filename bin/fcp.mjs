#!/usr/bin/env node
// `cut fcp`: the non-capturing Final Cut Pro driver, as a small set of
// primitives grouped by the object they act on. Every command dispatches
// into Final Cut Pro via osascript Accessibility actions only — no cliclick,
// no keystroke-to-frontmost, no AXRaise/activate, no screenshots. The user's
// cursor, keyboard, screen, and frontmost window are not touched.
//
// There is no command per menu item, Inspector slider or recipe: `menu list`
// names every menu path `menu click` reaches, and `ax` reaches every element
// the accessibility tree exposes, so a step a caller needs is composed from
// these rather than added here as one more verb.
//
// macOS will prompt once for Accessibility + Automation permission for
// "Final Cut Pro" and "System Events" the first time the controlling terminal
// runs any of these. Grant it in Settings → Privacy & Security → Accessibility
// and ... → Automation. After that the actions are silent.

import { isRunning, launchBackground, openFile, clickMenu, findInTree, setTextField, pressByLabel, osa } from "../lib/fcp-ax.mjs";
import { getAttr, setAttr, performAction, selectElement, dialogPress, dialogSetField, dumpTree, listMenus } from "../lib/fcp-ax-generic.mjs";

function need() {
  if (!isRunning()) throw new Error("Final Cut Pro is not running. `cut fcp app launch` first.");
}

function words(parts, usage) {
  if (parts.length === 0) throw new Error(`usage: cut fcp ${usage}`);
  return parts.join(" ");
}

// A process-level AX attribute (AXFrontmost, AXHidden) of Final Cut Pro
// itself, not of any of its windows.
function processAttr(attr) {
  return osa(`tell application "System Events" to return (value of attribute "${attr}" of process "Final Cut Pro") as text`);
}

// `--panel <menu path>` taken out of a verb's words, or a refusal naming it.
function panelPath(parts) {
  const at = parts.indexOf("--panel");
  if (at < 0) {
    throw new Error('browser apply needs --panel: the menu path that opens the browser, e.g. --panel "Window > Show in Workspace > Effects"');
  }
  const [, panel, ...after] = parts.splice(at);
  parts.push(...after);
  if (!panel) throw new Error("--panel needs the menu path that opens the browser");
  return panel.split(">").map((part) => part.trim());
}

const GROUPS = {
  app: {
    usage: "app status | app launch | app open <path>",
    verbs: {
      status() {
        if (!isRunning()) { console.log("running: no"); return; }
        console.log("running: yes");
        console.log(`frontmost: ${processAttr("AXFrontmost")}`);
        console.log(`hidden: ${processAttr("AXHidden")}`);
      },
      launch() { launchBackground(); console.log("launched (background)"); },
      open(parts) {
        const file = words(parts, "app open <path>");
        openFile(file);
        console.log(`opened ${file}`);
      },
    },
  },
  menu: {
    usage: "menu list | menu click <top> [<submenu>...] <leaf>",
    verbs: {
      list() { process.stdout.write(listMenus()); },
      click(path) {
        const [top, ...below] = path;
        if (!top || below.length === 0) throw new Error("usage: cut fcp menu click <top> [<submenu>...] <leaf>   e.g. menu click Edit Undo");
        need();
        clickMenu(path);
        console.log(`menu: ${path.join(" → ")}`);
      },
    },
  },
  // A browser is one of FCP's catalog panes (Effects, Transitions, Titles and
  // Generators). The pane is opened through the menu path the caller names,
  // as `menu list` prints it, so no pane location is assumed here. A row that
  // is not there yet fails the press with the label it looked for.
  browser: {
    usage: 'browser apply <name> --panel "<top> > <submenu> > <leaf>"',
    verbs: {
      apply(parts) {
        const panel = panelPath(parts);
        const name = words(parts, 'browser apply <name> --panel "<top> > <submenu> > <leaf>"');
        need();
        clickMenu(panel);
        setTextField("Search", name);
        pressByLabel(name);
        console.log(`applied: ${name}`);
      },
    },
  },
  ax: {
    usage: "ax get <attr> <needle> | ax set <attr> <needle> <value> | ax press <action> <needle> | ax select <needle> | ax find <substring> | ax dump",
    verbs: {
      get([attr, ...rest]) {
        const needle = words(rest, "ax get <attr> <needle...>");
        process.stdout.write(`${getAttr(needle, attr)}\n`);
      },
      set([attr, needle, ...value]) {
        const text = words(value, "ax set <attr> <needle> <value>");
        setAttr(needle, attr, text);
        console.log(`ax set: ${attr} of "${needle}" = "${text}"`);
      },
      press([action, ...rest]) {
        const needle = words(rest, "ax press <action> <needle...>");
        performAction(needle, action);
        console.log(`ax press: ${action} on "${needle}"`);
      },
      select(parts) {
        const needle = words(parts, "ax select <needle...>");
        selectElement(needle);
        console.log(`selected: ${needle}`);
      },
      find(parts) { process.stdout.write(findInTree(words(parts, "ax find <substring>"))); },
      dump() { process.stdout.write(dumpTree()); },
    },
  },
  dialog: {
    usage: "dialog press <label> | dialog set <field> <value>",
    verbs: {
      press(parts) {
        const label = words(parts, "dialog press <label...>");
        dialogPress(label);
        console.log(`dialog button pressed: ${label}`);
      },
      set([field, ...value]) {
        dialogSetField(field, words(value, "dialog set <field> <value>"));
        console.log(`dialog field "${field}" set`);
      },
    },
  },
};

function printHelp() {
  console.log("cut fcp — non-capturing Final Cut Pro driver");
  console.log("");
  console.log("Every command dispatches via macOS Accessibility actions only.");
  console.log("No cursor warp, no keystroke-to-frontmost, no screen capture,");
  console.log("no focus-stealing activate — Final Cut Pro can stay backgrounded.");
  console.log("");
  console.log("Commands:");
  for (const group of Object.values(GROUPS)) {
    for (const usage of group.usage.split(" | ")) console.log(`  cut fcp ${usage}`);
  }
  console.log("");
  console.log("A multi-step job (Share → Export File, a retime prompt) is the same");
  console.log('primitives in order: menu click File Share "Export File (default)…",');
  console.log("then dialog set Title <name>, then dialog press Next…, then dialog press Save.");
  console.log("");
  console.log("First-time use: grant Accessibility + Automation permission for");
  console.log("Final Cut Pro + System Events to this terminal in Settings.");
}

// Every leaf by its whole name ("menu click"), so an unknown object or verb
// is one refusal below.
const CMD = Object.fromEntries([
  ["help", printHelp],
  ...Object.entries(GROUPS).flatMap(([object, group]) =>
    Object.entries(group.verbs).map(([verb, run]) => [`${object} ${verb}`, run]),
  ),
]);

const [object, verb, ...rest] = process.argv.slice(2);
const cmd = verb === undefined || object === "help" ? object : `${object} ${verb}`;
if (!cmd || cmd === "-h" || cmd === "--help") { printHelp(); process.exit(0); }
if (!CMD[cmd]) { console.error(`unknown command: cut fcp ${cmd}. 'cut fcp help' lists every object and its verbs.`); process.exit(2); }
try {
  CMD[cmd](rest);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
