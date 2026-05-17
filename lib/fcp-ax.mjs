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

// Click a top-level menu item: clickMenu(["File", "Save"]) → File > Save.
// Nested submenus: clickMenu(["File", "Share", "Master File…"]).
// `click menu item` synthesizes the menu-item invocation into FCP's AX tree;
// no menu UI appears, no cursor movement, FCP need not be frontmost.
export function clickMenu(path) {
  if (!Array.isArray(path) || path.length < 2) throw new Error("clickMenu([top, ...nested, leaf])");
  const top = path[0];
  const leaf = path[path.length - 1];
  const mid = path.slice(1, -1);
  // Build the nested "of menu N of menu item N-1 ... of menu top of menu bar 1" chain.
  let target = `menu item "${leaf}" of menu "${path[path.length - 2] || top}" of menu bar 1`;
  if (mid.length > 0) {
    let chain = `menu "${path[path.length - 2]}"`;
    for (let i = path.length - 2; i >= 1; i--) {
      chain = `menu "${path[i]}" of menu item "${path[i]}" of ${i === 1 ? `menu "${top}" of menu bar 1` : chain}`;
    }
    target = `menu item "${leaf}" of ${chain}`;
  }
  osa(`
    tell application "System Events"
      tell process "Final Cut Pro"
        click ${target} of menu bar item "${top}" of menu bar 1
      end tell
    end tell
  `);
}

// Read-only AX tree dump filtered for a label substring. Used to verify state
// and to discover element paths. Returns a newline-separated list of matches.
export function findInTree(needle) {
  return osa(`
    tell application "System Events"
      tell process "Final Cut Pro"
        set acc to ""
        repeat with w in windows
          try
            set elems to entire contents of w
            repeat with e in elems
              try
                set d to description of e
                if d contains "${needle}" then
                  set acc to acc & (role of e) & " | " & d & linefeed
                end if
              end try
            end repeat
          end try
        end repeat
        return acc
      end tell
    end tell
  `);
}

// Set the value of an AXTextField whose AXDescription contains `fieldHint`.
// Used to type into the Effects-browser search box without sending keystrokes.
export function setTextField(fieldHint, value) {
  // Escape AppleScript string delimiters in the value.
  const esc = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  osa(`
    tell application "System Events"
      tell process "Final Cut Pro"
        set found to false
        repeat with w in windows
          try
            set elems to entire contents of w
            repeat with e in elems
              try
                if role of e is "AXTextField" and description of e contains "${fieldHint}" then
                  set value of e to "${esc}"
                  set found to true
                  exit repeat
                end if
              end try
            end repeat
          end try
          if found then exit repeat
        end repeat
        if not found then error "no AXTextField matching: ${fieldHint}"
      end tell
    end tell
  `);
}

// AXPress the first AX element whose description / value matches `label`.
// Effects, presets, share items, etc — invoke without clicking.
export function pressByLabel(label) {
  const esc = label.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  osa(`
    tell application "System Events"
      tell process "Final Cut Pro"
        set done to false
        repeat with w in windows
          try
            set elems to entire contents of w
            repeat with e in elems
              try
                if (description of e is "${esc}") or (value of e is "${esc}") or (name of e is "${esc}") then
                  perform action "AXPress" of e
                  set done to true
                  exit repeat
                end if
              end try
            end repeat
          end try
          if done then exit repeat
        end repeat
        if not done then error "no element matching: ${esc}"
      end tell
    end tell
  `);
}
