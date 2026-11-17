// Generic AX primitives for Final Cut Pro. These complement lib/fcp-ax.mjs's
// fixed-purpose helpers (clickMenu, setTextField, pressByLabel) with universal
// read / write / action / select / dialog primitives that can reach any
// element FCP's accessibility tree exposes — Inspector parameters, modal
// sheets, popup menus, sliders, selectable rows, etc.
//
// Same non-capturing contract as fcp-ax.mjs: osascript Accessibility actions
// targeting the Final Cut Pro process only. No cliclick, no keystrokes, no
// screencapture, no activate / AXRaise / frontmost set. FCP can be
// backgrounded throughout.

import { elementWalk, labelled, osa } from "./fcp-ax.mjs";

function asEsc(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Read an AX attribute (value, AXValue, AXSize, AXEnabled, AXHelp, AXURL...)
// of the first element matching needle. Pure read — no events synthesized.
export function getAttr(needle, attr) {
  const n = asEsc(needle);
  const a = asEsc(attr);
  return osa(elementWalk({
    test: labelled(n),
    act: `return (get value of attribute "${a}" of e) as text`,
    refusal: `getAttr: no element matching: ${n}`,
  }));
}

// Write an AX attribute on the first matching element. Works on sliders
// (AXValue), checkboxes (0/1), popup menus, incrementors. Inspector controls
// are addressable by AXDescription.
export function setAttr(needle, attr, value) {
  const n = asEsc(needle);
  const a = asEsc(attr);
  const v = asEsc(value);
  osa(elementWalk({
    test: labelled(n),
    act: `set value of attribute "${a}" of e to "${v}"`,
    refusal: `setAttr: no element matching: ${n}`,
  }));
}

// Perform any AX action on the first matching element. FCP exposes AXPress,
// AXIncrement / AXDecrement, AXShowMenu, AXCancel, AXConfirm.
export function performAction(needle, action) {
  const n = asEsc(needle);
  const a = asEsc(action);
  osa(elementWalk({
    test: labelled(n),
    act: `perform action "${a}" of e`,
    refusal: `performAction: no element matching: ${n}`,
  }));
}

// `select` the first matching selectable element (timeline / browser clip,
// list row, popover item) — no mouse click required.
export function selectElement(needle) {
  const n = asEsc(needle);
  osa(elementWalk({
    test: labelled(n),
    act: `select e`,
    refusal: `selectElement: no element matching: ${n}`,
  }));
}

// Press a button by name in the topmost modal sheet (Share, Save Library As,
// alerts attach as `sheet 1 of window 1`). Falls back to the window if no
// sheet is open.
export function dialogPress(label) {
  const n = asEsc(label);
  osa(`
    tell application "System Events"
      tell process "Final Cut Pro"
        set done to false
        repeat with w in windows
          try
            if (count of sheets of w) > 0 then
              set sh to sheet 1 of w
              try
                click button "${n}" of sh
                set done to true
                exit repeat
              end try
              try
                set btns to entire contents of sh
                repeat with b in btns
                  try
                    if (role of b is "AXButton") and ((name of b is "${n}") or (description of b is "${n}")) then
                      perform action "AXPress" of b
                      set done to true
                      exit repeat
                    end if
                  end try
                end repeat
              end try
            end if
          end try
          if done then exit repeat
          try
            click button "${n}" of w
            set done to true
            exit repeat
          end try
        end repeat
        if not done then error "dialogPress: no button matching: ${n}"
      end tell
    end tell
  `);
}

// Set a text field by description in the topmost modal sheet only. Used for
// Save-As filename, Share Description/Title/Tags. setTextField scans every
// window; this restricts to the active sheet so the right field is found.
export function dialogSetField(fieldHint, value) {
  const n = asEsc(fieldHint);
  const v = asEsc(value);
  osa(`
    tell application "System Events"
      tell process "Final Cut Pro"
        set done to false
        repeat with w in windows
          try
            if (count of sheets of w) > 0 then
              set sh to sheet 1 of w
              set elems to entire contents of sh
              repeat with e in elems
                try
                  if role of e is "AXTextField" and (description of e contains "${n}" or name of e contains "${n}") then
                    set value of e to "${v}"
                    set done to true
                    exit repeat
                  end if
                end try
              end repeat
            end if
          end try
          if done then exit repeat
        end repeat
        if not done then error "dialogSetField: no sheet field matching: ${n}"
      end tell
    end tell
  `);
}

// Enumerate every menu-bar-reachable command in FCP, up to four levels
// (Modify > Adjust Volume > Down). Each line is invokable via
// `cut fcp menu click <Top> <Sub...> <Leaf>`. Pure read.
export function listMenus() {
  return osa(`
    tell application "System Events"
      tell process "Final Cut Pro"
        set acc to ""
        repeat with mb in menu bar items of menu bar 1
          set tn to ""
          try
            set tn to name of mb
          end try
          if tn is not "" then
            try
              repeat with mi in menu items of menu 1 of mb
                try
                  set n1 to name of mi
                  if n1 is not "" and n1 is not missing value then
                    set acc to acc & tn & " > " & n1 & linefeed
                    try
                      repeat with mi2 in menu items of menu 1 of mi
                        try
                          set n2 to name of mi2
                          if n2 is not "" and n2 is not missing value then
                            set acc to acc & tn & " > " & n1 & " > " & n2 & linefeed
                            try
                              repeat with mi3 in menu items of menu 1 of mi2
                                try
                                  set n3 to name of mi3
                                  if n3 is not "" and n3 is not missing value then
                                    set acc to acc & tn & " > " & n1 & " > " & n2 & " > " & n3 & linefeed
                                  end if
                                end try
                              end repeat
                            end try
                          end if
                        end try
                      end repeat
                    end try
                  end if
                end try
              end repeat
            end try
          end if
        end repeat
        return acc
      end tell
    end tell
  `);
}

// Enumerate the topmost FCP window's AX tree: "role | description | value"
// per line. Discovery helper.
export function dumpTree() {
  return osa(elementWalk({
    topmost: true,
    act: `set r to role of e
                  set d to ""
                  try
                    set d to description of e
                  end try
                  set v to ""
                  try
                    set v to (value of e) as text
                  end try
                  set acc to acc & r & " | " & d & " | " & v & linefeed`,
  }));
}
