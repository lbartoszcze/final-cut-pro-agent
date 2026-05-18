// Atomic named wrappers for techniques extracted from references/youtube-
// transcripts/. Each command maps onto one menu click or one inspect-set.
//
// Same non-capturing contract: osascript AX actions on Final Cut Pro only.

import { clickMenu, isRunning, setTextField, pressByLabel, findInTree } from "../fcp-ax.mjs";
import { setAttr, getAttr, performAction } from "../fcp-ax-generic.mjs";

function need() {
  if (!isRunning()) throw new Error("Final Cut Pro is not running. `cut fcp launch` first.");
}

function focusInspector() {
  try { clickMenu(["Window", "Show in Workspace", "Inspector"]); } catch (_) {}
  try { clickMenu(["Window", "Go To", "Inspector"]); } catch (_) {}
}

const sleep = (sec) => new Promise((r) => setTimeout(r, sec * 1000));

export const TECHNIQUES = {
  // ---- Inspector-driven settings the tutorials reach for first ----
  // Spatial Conform — Inspector "Type" popup under Spatial Conform on a clip.
  // Used in vertical-video tutorial to fill 9:16 from 16:9 source.
  "spatial-conform"([mode]) {
    if (!mode) throw new Error("spatial-conform <fit|fill|none>");
    need(); focusInspector();
    setAttr("Spatial Conform Type", "AXValue", mode);
    console.log(`spatial-conform = ${mode}`);
  },
  // Camera LUT toggle in Inspector > Info > Settings.
  // Used in LOG-grading tutorial to disable the camera's default Rec.709 LUT.
  "camera-lut"([state]) {
    if (state !== "on" && state !== "off") throw new Error("camera-lut <on|off>");
    need(); focusInspector();
    setAttr("Camera LUT", "AXValue", state === "on" ? "1" : "0");
    console.log(`camera-lut = ${state}`);
  },
  // Color Space Override on the project / clip (Inspector > Settings).
  "color-space-override"([cs]) {
    if (!cs) throw new Error("color-space-override <rec709|rec2020|appleLogV1|appleLogV2>");
    need(); focusInspector();
    setAttr("Color Space Override", "AXValue", cs);
    console.log(`color-space-override = ${cs}`);
  },
  // Apply a Custom LUT effect to the selected clip via the catalog browser.
  // The user then sets the LUT file in the Inspector after this fires.
  async "apply-custom-lut"([..._rest]) {
    need();
    clickMenu(["Window", "Show in Workspace", "Effects"]);
    await sleep(0.4);
    setTextField("Search", "Custom LUT");
    await sleep(0.4);
    pressByLabel("Custom LUT");
    console.log("apply-custom-lut: Custom LUT effect applied; set the LUT file via Inspector");
  },
  // Voice Isolation slider (Audio Inspector). Tutorial sweet-spot is 70-80.
  "voice-isolate"([level]) {
    if (level == null) throw new Error("voice-isolate <0-100>");
    need(); focusInspector();
    setAttr("Voice Isolation", "AXValue", String(level));
    console.log(`voice-isolate = ${level}`);
  },
  // Set clip Camera Name (Inspector > Info > Settings) for Multicam grouping.
  "set-camera-name"([..._rest]) {
    const name = _rest.join(" ");
    if (!name) throw new Error("set-camera-name <name>");
    need(); focusInspector();
    setAttr("Camera Name", "AXValue", name);
    console.log(`set-camera-name = ${name}`);
  },
  // Inspector > Effects > Compositing > Anchor (Transform). Two-component.
  "set-anchor"([x, y]) {
    if (x == null || y == null) throw new Error("set-anchor <x> <y>");
    need(); focusInspector();
    setAttr("Anchor X", "AXValue", String(x));
    setAttr("Anchor Y", "AXValue", String(y));
    console.log(`set-anchor = (${x}, ${y})`);
  },

  // ---- Edit menu shortcuts the tutorials hammer ----
  "freeze-frame": () => { need(); clickMenu(["Edit", "Add Freeze Frame"]); console.log("freeze frame"); },
  "ripple-trim-left":  () => { need(); clickMenu(["Trim", "Trim Start"]); console.log("ripple trim start"); },
  "ripple-trim-right": () => { need(); clickMenu(["Trim", "Trim End"]);   console.log("ripple trim end"); },

  // (Proxy/Optimized playback switching lives on the Viewer-toolbar
  // AXMenuButton, not in the menu bar. Use `transcode-media` to generate the
  // proxies and switch via FCP's Viewer popup. A future wrapper can drive
  // that popup via ax-press AXShowMenu once a project is open to dump its
  // labels.)

  // ---- Captions ----
  // Edit > Captions > Add Caption — built-in caption authoring entry point.
  "caption-add":  () => { need(); clickMenu(["Edit", "Captions", "Add Caption"]); console.log("caption added"); },
  // Transcribe a clip's dialogue to captions via the built-in transcriber.
  "caption-transcribe": () => {
    need();
    try { clickMenu(["Edit", "Captions", "Transcribe to Captions…"]); }
    catch (_) { clickMenu(["Edit", "Captions", "Transcribe to Captions"]); }
    console.log("caption transcribe invoked");
  },

  // ---- Keyword & favorite operations ----
  // cmd+K opens the Keyword Editor; typing text + Return assigns the keyword.
  async "assign-keyword"([..._rest]) {
    const kw = _rest.join(" ");
    if (!kw) throw new Error("assign-keyword <kw>");
    need();
    clickMenu(["Mark", "Show Keyword Editor"]);
    await sleep(0.3);
    setTextField("Keyword", kw);
    // The Keyword Editor commits on focus-loss / Return. Press the matching
    // suggestion if it surfaces; otherwise leave the typed value committed.
    try { pressByLabel(kw); } catch (_) {}
    console.log(`assign-keyword = ${kw}`);
  },

  // ---- Inspector — Audio Compositing extras ----
  "audio-pan":      ([v]) => { if (v==null) throw new Error("audio-pan <-100..100>"); need(); focusInspector(); setAttr("Pan Amount","AXValue",String(v)); console.log(`audio-pan = ${v}`); },
  "audio-pan-mode": ([m]) => { if (!m)      throw new Error("audio-pan-mode <Stereo Left/Right|Surround|...>"); need(); focusInspector(); setAttr("Pan Mode","AXValue",m); console.log(`audio-pan-mode = ${m}`); },

  // ---- Background-render preference: Settings > Playback ----
  // Opens FCP Settings > Playback. The Background Render checkbox is then
  // accessible via inspect-press "Background render".
  "open-playback-prefs": () => {
    need();
    clickMenu(["Final Cut Pro", "Settings…"]);
    console.log("Settings opened; switch to Playback tab manually or via dialog AX");
  },

  // ---- Scopes toggle (View > Show in Viewer > Video Scopes) — alias ----
  scopes: () => { need(); clickMenu(["View", "Show in Viewer", "Video Scopes"]); console.log("scopes"); },

  // ---- Reset Inspector parameter to default (right-click → Reset; we use
  // AXShowMenu on the parameter label then dialog-press Reset). Best-effort.
  "reset-param"([..._rest]) {
    const param = _rest.join(" ");
    if (!param) throw new Error("reset-param <param-description>");
    need(); focusInspector();
    performAction(param, "AXShowMenu");
    console.log(`reset-param: AXShowMenu fired on "${param}"; complete via dialog-button Reset`);
  },

  // ---- Inspector dump: enumerate every control reachable in the Inspector.
  // Used to discover real AXDescriptions when a setter errors.
  "inspector-dump"() {
    need();
    focusInspector();
    process.stdout.write(findInTree(""));
  },
};

export const TECHNIQUES_HELP = [
  ["Conform / format",  ["spatial-conform <fit|fill|none>", "camera-lut <on|off>", "color-space-override <cs>"]],
  ["LUT / color",       ["apply-custom-lut", "reset-param <param>"]],
  ["Audio",             ["voice-isolate <0-100>", "audio-pan <v>", "audio-pan-mode <m>"]],
  ["Inspector / info",  ["set-camera-name <name>", "set-anchor <x> <y>"]],
  ["Editing",           ["freeze-frame", "ripple-trim-left", "ripple-trim-right"]],
  ["Playback",          ["scopes"]],
  ["Captions",          ["caption-add", "caption-transcribe"]],
  ["Keywords",          ["assign-keyword <kw>"]],
  ["Preferences",       ["open-playback-prefs"]],
  ["Discovery",         ["inspector-dump"]],
];
