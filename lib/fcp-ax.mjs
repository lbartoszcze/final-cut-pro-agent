// AX primitives for Final Cut Pro. Used by fcp.mjs.

import { execFileSync } from "node:child_process";

export const CLICLICK = "/opt/homebrew/bin/cliclick";

export function osa(script) {
  return execFileSync("osascript", [], { encoding: "utf8", input: script }).trim();
}

export function sleep(sec) {
  execFileSync("sleep", [String(sec)]);
}

export function activate() {
  osa(`
    tell application "Final Cut Pro" to activate
    delay 0.2
    tell application "System Events"
      tell process "Final Cut Pro"
        try
          perform action "AXRaise" of window 1
        end try
      end tell
    end tell
  `);
}

// Walk the Browser AXScrollArea and emit a row per asset clip.
export function listClips() {
  activate();
  const out = osa(`
    tell application "System Events"
      tell process "Final Cut Pro"
        set acc to ""
        repeat with w in windows
          try
            set allElems to entire contents of w
            repeat with e in allElems
              try
                if role of e is "AXRow" and (description of e contains "Clip" or description of e contains "asset") then
                  set p to position of e
                  set s to size of e
                  set acc to acc & (description of e) & "|" & (item 1 of p) & "|" & (item 2 of p) & "|" & (item 1 of s) & "|" & (item 2 of s) & linefeed
                end if
              end try
            end repeat
          end try
        end repeat
        return acc
      end tell
    end tell
  `);
  const clips = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [desc, x, y, w, h] = line.split("|");
    clips.push({ description: desc, x: parseInt(x), y: parseInt(y), w: parseInt(w), h: parseInt(h) });
  }
  return clips;
}

// Walk the Libraries sidebar AXOutline for events.
export function listEvents() {
  activate();
  return osa(`
    tell application "System Events"
      tell process "Final Cut Pro"
        set acc to ""
        repeat with w in windows
          try
            set allElems to entire contents of w
            repeat with e in allElems
              try
                if role of e is "AXRow" and value of attribute "AXSubrole" of e is "AXOutlineRow" then
                  try
                    set lbl to value of (first UI element of e whose role is "AXStaticText")
                    set acc to acc & lbl & linefeed
                  end try
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

export function listProjects() { return listEvents(); }

// Click an event/project row by exact label.
export function selectEvent(label) {
  osa(`
    tell application "System Events"
      tell process "Final Cut Pro"
        repeat with w in windows
          try
            set allElems to entire contents of w
            repeat with e in allElems
              try
                if role of e is "AXRow" and value of attribute "AXSubrole" of e is "AXOutlineRow" then
                  try
                    set lbl to value of (first UI element of e whose role is "AXStaticText")
                    if lbl is "${label.replace(/"/g, '\\"')}" then
                      perform action "AXPress" of e
                      return "ok"
                    end if
                  end try
                end if
              end try
            end repeat
          end try
        end repeat
        return "notfound"
      end tell
    end tell
  `);
  sleep(0.3);
}

// FCP timeline clip: AXLayoutItem in the timeline AXScrollArea.
export function listTimelineClips() {
  activate();
  const out = osa(`
    tell application "System Events"
      tell process "Final Cut Pro"
        set acc to ""
        repeat with w in windows
          try
            set allElems to entire contents of w
            repeat with e in allElems
              try
                if role of e is "AXLayoutItem" then
                  set d to description of e
                  if d contains "Clip" or d contains "Title" then
                    set p to position of e
                    set s to size of e
                    set acc to acc & d & "|" & (item 1 of p) & "|" & (item 2 of p) & "|" & (item 1 of s) & "|" & (item 2 of s) & linefeed
                  end if
                end if
              end try
            end repeat
          end try
        end repeat
        return acc
      end tell
    end tell
  `);
  const clips = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [desc, x, y, w, h] = line.split("|");
    clips.push({ description: desc, x: parseInt(x), y: parseInt(y), w: parseInt(w), h: parseInt(h) });
  }
  return clips;
}

export function keystroke(key, modifiers = []) {
  activate();
  const mod = modifiers.length
    ? ` using {${modifiers.map((m) => `${m} down`).join(", ")}}`
    : "";
  osa(`tell application "System Events" to tell process "Final Cut Pro" to keystroke "${key}"${mod}`);
}

export function keyCode(code, modifiers = []) {
  activate();
  const mod = modifiers.length
    ? ` using {${modifiers.map((m) => `${m} down`).join(", ")}}`
    : "";
  osa(`tell application "System Events" to tell process "Final Cut Pro" to key code ${code}${mod}`);
}

// Effects browser search field (cmd-5 to focus, then type).
export function setEffectSearch(query) {
  osa(`
    tell application "System Events"
      tell process "Final Cut Pro"
        repeat with w in windows
          try
            set allElems to entire contents of w
            repeat with e in allElems
              try
                if role of e is "AXTextField" then
                  set d to ""
                  try
                    set d to description of e
                  end try
                  if d contains "Effects" or d is "search text field" then
                    set focused of e to true
                    delay 0.1
                    set value of e to ""
                    delay 0.1
                    set value of e to "${query.replace(/"/g, '\\"')}"
                    delay 0.5
                    return "ok"
                  end if
                end if
              end try
            end repeat
          end try
        end repeat
        return "notfound"
      end tell
    end tell
  `);
}

// Find an effect row by label match in the Effects browser.
export function findEffectRow(label) {
  return osa(`
    tell application "System Events"
      tell process "Final Cut Pro"
        set coord to "none"
        repeat with w in windows
          try
            set allElems to entire contents of w
            repeat with e in allElems
              try
                if role of e is "AXRow" then
                  set lbl to ""
                  repeat with c in UI elements of e
                    try
                      repeat with cc in UI elements of c
                        try
                          set v to value of cc
                          if v is not missing value then set lbl to lbl & v & " "
                        end try
                      end repeat
                    end try
                  end repeat
                  if lbl contains "${label.replace(/"/g, '\\"')}" then
                    set p to position of e
                    set s to size of e
                    set cx to (item 1 of p) + (item 1 of s) / 2
                    set cy to (item 2 of p) + (item 2 of s) / 2
                    set coord to (cx as integer) & "," & (cy as integer)
                    exit repeat
                  end if
                end if
              end try
            end repeat
          end try
        end repeat
        return coord
      end tell
    end tell
  `);
}

export function doubleClick(coord) {
  execFileSync(CLICLICK, [`dc:${coord}`]);
}
