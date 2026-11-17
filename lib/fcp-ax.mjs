// Final Cut Pro automation that does not capture the user's work.
//
// "Capturing work" here means anything that hijacks the user's physical
// cursor, keyboard, or screen, or steals focus from whatever they're doing:
//   - cliclick / CGEvent mouse warps    — moves your real cursor.       BANNED.
//   - keystroke "..."  via System Events — types into the FRONTMOST app. BANNED.
//   - activate / AXRaise / frontmost set — steals window focus.          BANNED.
//   - screencapture / CG screen capture  — grabs your screen.            BANNED.
//
// The only mechanism used here is osascript Accessibility actions on the
// Final Cut Pro process tree. `tell process "Final Cut Pro"` followed by
// `click menu item ... of menu ... of menu bar 1`, `perform action AXPress`,
// `set value`, or read-only tree queries. These dispatch the action directly
// into FCP via the macOS accessibility API; no cursor moves, no menu pops
// up visually, FCP can be backgrounded, the user's frontmost app stays
// frontmost.
//
// Every osascript string here contains the literal "Final Cut Pro" so the
// shared pre_bash hook (which permits osascript only when it targets FCP)
// allows it through. First-time use will require macOS to grant the
// controlling terminal Accessibility + Automation permission for "Final
// Cut Pro" and "System Events" (Settings → Privacy & Security).

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Run an AppleScript via stdin. Throws on non-zero exit.
export function osa(script) {
  if (!/Final Cut Pro/.test(script)) {
    throw new Error("osa(): script must reference Final Cut Pro (hook scoping).");
  }
  return execFileSync("osascript", [], { encoding: "utf8", input: script }).trim();
}

// `text` as the inside of an AppleScript string: backslashes and quotes
// escaped, so text a caller names can never end the string and add code.
export function asEsc(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// The AppleScript test that `e`'s description, value or name is `label`,
// which must already be escaped for an AppleScript string (asEsc).
export function labelled(label) {
  return `(description of e is "${label}") or (value of e is "${label}") or (name of e is "${label}")`;
}

// The AppleScript of one walk over Final Cut Pro's accessibility tree: the
// loop every element lookup here and in fcp-ax-generic.mjs runs. For each
// element `e` in the `entire contents` of each window (of the topmost one
// only, with `topmost`) for which the condition `test` holds, `act` runs.
// With `refusal`, the walk ends after the first such element and the script
// errors with `refusal` when there was none; without it, every element is
// visited and the script returns `acc`, which `act` appends to. An element or
// a window whose attributes cannot be read is passed over. `test`, `act` and
// `refusal` are AppleScript source: text interpolated into them must already
// be escaped (asEsc).
export function elementWalk({ test = "true", act, refusal, topmost = false }) {
  const first = refusal !== undefined;
  const windows = topmost ? "scanned" : "windows";
  return `
    tell application "System Events"
      tell process "Final Cut Pro"
        set acc to ""
        set done to false${topmost ? `
        set scanned to {}
        if (count of windows) > 0 then set scanned to {window 1}` : ""}
        repeat with w in ${windows}
          try
            set elems to entire contents of w
            repeat with e in elems
              try
                if ${test} then
                  ${act}${first ? `
                  set done to true
                  exit repeat` : ""}
                end if
              end try
            end repeat
          end try${first ? `
          if done then exit repeat` : ""}
        end repeat
        ${first ? `if not done then error "${refusal}"` : "return acc"}
      end tell
    end tell
  `;
}

// Is FCP running right now? Pure read-only AX query.
export function isRunning() {
  const out = osa(`tell application "System Events" to return (name of processes) contains "Final Cut Pro"`);
  return out === "true";
}

// Launch FCP without bringing it to the foreground. -g = background launch.
export function launchBackground() {
  execFileSync("open", ["-g", "-a", "Final Cut Pro"]);
}

// Open a project / fcpxml in FCP. -g keeps your frontmost window where it is.
// FCP itself may briefly take focus while it parses the import; this is the
// open action's own behavior, not extra automation capturing input.
export function openFile(file) {
  execFileSync("open", ["-g", "-a", "Final Cut Pro", resolve(file)]);
}

// Click a top-level menu item: clickMenu(["File", "Save Project"]) → File >
// Save Project. Nested submenus: clickMenu(["File", "Share", "Master File…"]).
// `click menu item` synthesizes the menu-item invocation into FCP's AX tree;
// no menu UI appears, no cursor movement, FCP need not be frontmost.
//
// AppleScript syntax for nested menus (verified against System Events tree):
//   2-level [top, leaf]:
//     click menu item LEAF of menu TOP of menu bar item TOP of menu bar 1
//   3-level [top, sub, leaf]:
//     click menu item LEAF of menu SUB of menu item SUB of menu TOP of menu bar item TOP of menu bar 1
//   ...generalised: each intermediate level adds "menu X of menu item X of".
export function clickMenu(path) {
  if (!Array.isArray(path) || path.length < 2) throw new Error("clickMenu([top, ...nested, leaf])");
  const [top, ...below] = path;
  const leaf = below.pop();
  let chain = `menu "${top}" of menu bar item "${top}" of menu bar 1`;
  for (const item of below) {
    chain = `menu "${item}" of menu item "${item}" of ${chain}`;
  }
  const target = `menu item "${leaf}" of ${chain}`;
  osa(`
    tell application "System Events"
      tell process "Final Cut Pro"
        click ${target}
      end tell
    end tell
  `);
}

// Read-only AX tree dump filtered for a label substring. Used to verify state
// and to discover element paths. Returns a newline-separated list of matches.
export function findInTree(needle) {
  return osa(elementWalk({
    test: `description of e contains "${asEsc(needle)}"`,
    act: `set acc to acc & (role of e) & " | " & (description of e) & linefeed`,
  }));
}

// Set the value of an AXTextField whose AXDescription contains `fieldHint`.
// Used to type into the Effects-browser search box without sending keystrokes.
export function setTextField(fieldHint, value) {
  const hint = asEsc(fieldHint);
  osa(elementWalk({
    test: `role of e is "AXTextField" and description of e contains "${hint}"`,
    act: `set value of e to "${asEsc(value)}"`,
    refusal: `no AXTextField matching: ${hint}`,
  }));
}

// AXPress the first AX element whose description / value matches `label`.
// Effects, presets, share items, etc — invoke without clicking.
export function pressByLabel(label) {
  const esc = asEsc(label);
  osa(elementWalk({
    test: labelled(esc),
    act: `perform action "AXPress" of e`,
    refusal: `no element matching: ${esc}`,
  }));
}
