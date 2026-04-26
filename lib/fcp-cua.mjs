// cua-driver wrapper for Final Cut Pro — background computer-use.
// Requires cua-driver binary at .cua/cua-driver and its daemon running.
// Start the daemon with: .cua/cua-driver serve &

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CUA_BIN = join(HERE, "..", ".cua", "cua-driver");

function requireBinary() {
  if (!existsSync(CUA_BIN)) {
    throw new Error(`cua-driver not found at ${CUA_BIN}. Run: bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"`);
  }
}

function call(tool, args = {}) {
  requireBinary();
  const out = execFileSync(CUA_BIN, ["call", tool, JSON.stringify(args)], {
    encoding: "utf8",
    maxBuffer: 50_000_000,
  });
  return out;
}

export function ensureDaemon() {
  requireBinary();
  try {
    execFileSync(CUA_BIN, ["status"], { encoding: "utf8" });
    return "running";
  } catch {
    spawn(CUA_BIN, ["serve"], { detached: true, stdio: "ignore" }).unref();
    execFileSync("sleep", ["1.5"]);
    return "started";
  }
}

// Find Final Cut Pro pid + main timeline window. Final Cut's main window is
// typically named after the open library, e.g. "Untitled Library — Untitled".
export function getFcp() {
  const apps = call("list_apps", {});
  const appMatch = apps.match(/Final Cut Pro \(pid (\d+)\)/);
  if (!appMatch) throw new Error("Final Cut Pro is not running. Launch it first.");
  const pid = parseInt(appMatch[1]);

  const windows = call("list_windows", {});
  const lines = windows.split("\n");
  for (const line of lines) {
    if (line.includes(`pid ${pid}`) && /Library|Untitled/.test(line)) {
      const m = line.match(/window_id: (\d+)/);
      if (m) return { pid, window_id: parseInt(m[1]) };
    }
  }
  for (const line of lines) {
    if (line.includes(`pid ${pid}`)) {
      const m = line.match(/window_id: (\d+)/);
      if (m) return { pid, window_id: parseInt(m[1]) };
    }
  }
  throw new Error("No Final Cut Pro window found.");
}

export function findWindowId(pid, namePart) {
  const out = call("list_windows", {});
  for (const line of out.split("\n")) {
    if (line.includes(`pid ${pid}`) && line.includes(namePart)) {
      const m = line.match(/window_id: (\d+)/);
      if (m) return parseInt(m[1]);
    }
  }
  return null;
}

export function waitForWindow(pid, namePart, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const id = findWindowId(pid, namePart);
    if (id) return id;
    execFileSync("sleep", ["0.2"]);
  }
  throw new Error(`Window matching "${namePart}" did not appear within ${timeoutMs}ms`);
}

export function hotkey(pid, keys) { return call("hotkey", { pid, keys }); }
export function snapshot(pid, window_id, mode = "ax") { return call("get_window_state", { pid, window_id, capture_mode: mode }); }
export function clickIndex(pid, window_id, element_index, action) {
  const args = { pid, window_id, element_index };
  if (action) args.action = action;
  return call("click", args);
}
export function setValue(pid, window_id, element_index, value) {
  return call("set_value", { pid, window_id, element_index, value });
}
export function pressKey(pid, key) { return call("press_key", { pid, key }); }
export function typeText(pid, text) { return call("type_text", { pid, text }); }

export function getWindowBounds(pid, window_id) {
  const raw = execFileSync("osascript", [], {
    encoding: "utf8",
    input: `
      tell application "System Events"
        tell process "Final Cut Pro"
          set targetWin to missing value
          repeat with w in windows
            try
              if name of w does not contain "Effects" and name of w does not contain "Inspector" then
                set targetWin to w
                exit repeat
              end if
            end try
          end repeat
          if targetWin is missing value then return "nowin"
          set p to position of targetWin
          set s to size of targetWin
          return (item 1 of p as integer as string) & "|" & (item 2 of p as integer as string) & "|" & (item 1 of s as integer as string) & "|" & (item 2 of s as integer as string)
        end tell
      end tell
    `,
  }).trim();
  if (raw === "nowin") throw new Error("No Final Cut Pro main window found");
  const [x, y, w, h] = raw.split("|").map(Number);
  return { x, y, w, h };
}

function screenshotScale(pid, window_id) {
  const out = call("get_window_state", { pid, window_id, capture_mode: "vision" });
  const m = out.match(/Screenshot is (\d+)px wide/);
  if (!m) throw new Error("could not read screenshot width from Cua");
  const pngWidth = parseInt(m[1]);
  const wb = getWindowBounds(pid, window_id);
  return pngWidth / wb.w;
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function sleepSec(s) { execFileSync("sleep", [String(s)]); }

// Apply an effect by name. Opens Effects browser via cmd-5, clears search,
// types name, scrolls until the row is visible, double-clicks. Selected
// timeline clip receives the effect.
export function fcpEffect(pid, window_id, effectName) {
  hotkey(pid, ["cmd", "5"]);
  sleepSec(0.4);
  let tree = snapshot(pid, window_id);
  const searchRe = /\[(\d+)\] AXTextField[^\n]*(?:Effects|search)/i;
  const sm = tree.match(searchRe);
  if (sm) {
    setValue(pid, window_id, parseInt(sm[1]), effectName);
    sleepSec(0.4);
    tree = snapshot(pid, window_id);
  }
  const rowRe = new RegExp(`\\[(\\d+)\\] AXStaticText = "${escapeRegex(effectName)}"`);
  const rm = tree.match(rowRe);
  if (!rm) throw new Error(`effect "${effectName}" not visible after search`);
  call("double_click", { pid, window_id, element_index: parseInt(rm[1]) });
  sleepSec(0.5);
  return `applied ${effectName}`;
}

export function makePixelClicker(pid, window_id) {
  const wb = getWindowBounds(pid, window_id);
  const scale = screenshotScale(pid, window_id);
  return {
    click(screenX, screenY, { count = 1 } = {}) {
      const x = Math.round((screenX - wb.x) * scale);
      const y = Math.round((screenY - wb.y) * scale);
      return call("click", { pid, window_id, x, y, count });
    },
    toPng(screenX, screenY) {
      return { x: Math.round((screenX - wb.x) * scale), y: Math.round((screenY - wb.y) * scale) };
    },
    bounds: wb,
    scale,
  };
}

export function parseIndexedTree(treeText) {
  const re = /\[(\d+)\]\s+(\S+)\s+(?:"([^"]+)")?/g;
  const out = [];
  let m;
  while ((m = re.exec(treeText)) !== null) {
    out.push({ index: parseInt(m[1]), role: m[2], label: m[3] || "" });
  }
  return out;
}
