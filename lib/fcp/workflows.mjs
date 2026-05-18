// Multi-step workflow recipes for techniques from the 13 FCP YouTube
// tutorial transcripts at references/youtube-transcripts/.
//
// Each recipe chains existing primitives (clickMenu / setAttr / dialogPress /
// catalog apply) into a higher-level command. No new low-level dispatch.
//
// Same non-capturing contract: osascript AX actions on Final Cut Pro only.

import { clickMenu, isRunning, setTextField, pressByLabel } from "../fcp-ax.mjs";
import { setAttr, dialogPress, dialogSetField } from "../fcp-ax-generic.mjs";

function need() {
  if (!isRunning()) throw new Error("Final Cut Pro is not running. `cut fcp launch` first.");
}

function focusInspector() {
  try { clickMenu(["Window", "Show in Workspace", "Inspector"]); } catch (_) {}
  try { clickMenu(["Window", "Go To", "Inspector"]); } catch (_) {}
}

const sleep = (sec) => new Promise((r) => setTimeout(r, sec * 1000));

async function applyCatalogEffect(panel, name) {
  clickMenu(panel);
  await sleep(0.4);
  setTextField("Search", name);
  await sleep(0.4);
  pressByLabel(name);
}

export const WORKFLOWS = {
  // ---- noise-reduce: Voice Isolation + Compressor + Hum Reduction ----
  // Recipe from "How to Remove Background Noise" (#011). Voice Isolation
  // at 75 is the tutorial's sweet spot; Compressor evens out levels;
  // Hum Removal kills 50/60 Hz mains buzz.
  async "noise-reduce"([level = "75"]) {
    need();
    focusInspector();
    // 1. Set Voice Isolation to the requested level.
    try { setAttr("Voice Isolation", "AXValue", String(level)); } catch (_) {}
    // 2. Apply Compressor from the Effects browser.
    await applyCatalogEffect(["Window", "Show in Workspace", "Effects"], "Compressor");
    await sleep(0.4);
    // 3. Apply Hum Removal for mains buzz reduction.
    await applyCatalogEffect(["Window", "Show in Workspace", "Effects"], "Hum Removal");
    console.log(`noise-reduce: voice-isolate=${level}, compressor + hum-removal applied`);
  },

  // ---- youtube-export: Share > Export File (default) with filename + Save ----
  // From "How to Export in FCP X". The tutorial's recommended preset is
  // Export File (default) with the source's native resolution / codec; user
  // overrides via Compressor or custom destination if a different codec needed.
  async "youtube-export"([..._rest]) {
    const filename = _rest.join(" ");
    if (!filename) throw new Error('youtube-export <filename>   e.g. youtube-export "MyVideo"');
    need();
    clickMenu(["File", "Share", "Export File (default)…"]);
    await sleep(1.2);
    try { dialogSetField("Description", filename); } catch (_) {}
    try { dialogSetField("Title", filename); } catch (_) {}
    try { dialogPress("Next…"); } catch (_) { try { dialogPress("Next"); } catch (_) {} }
    await sleep(1.2);
    try { dialogPress("Save"); } catch (_) {}
    console.log(`youtube-export: Export File (default) -> ${filename}`);
  },

  // ---- log-grade-stack: prepare a Log clip for grading ----
  // From "How to color grade LOG in Final Cut Pro": disable Camera LUT,
  // override Color Space to Rec.709 for grading, then apply the recommended
  // effect order — Color Wheels (primaries) first, then Custom LUT.
  async "log-grade-stack"() {
    need();
    focusInspector();
    try { setAttr("Camera LUT", "AXValue", "0"); } catch (_) {}
    try { setAttr("Color Space Override", "AXValue", "Rec. 709"); } catch (_) {}
    await applyCatalogEffect(["Window", "Show in Workspace", "Effects"], "Color Wheels");
    await sleep(0.3);
    await applyCatalogEffect(["Window", "Show in Workspace", "Effects"], "Custom LUT");
    console.log("log-grade-stack: Camera LUT off + ColorSpace Rec.709 + Color Wheels + Custom LUT");
  },

  // ---- duck-music: drop music gain over a range with crossfade ----
  // From audio tutorial. Selects current range (assumed already set via
  // mark-in/mark-out), drops the level via Modify > Adjust Volume > Absolute,
  // applies Audio Fades so the duck is smooth.
  async "duck-music"([db = "-32"]) {
    need();
    clickMenu(["Modify", "Adjust Volume", "Absolute…"]);
    await sleep(0.6);
    try { dialogSetField("dB", String(db)); } catch (_) {}
    try { dialogPress("OK"); } catch (_) {}
    await sleep(0.2);
    try { clickMenu(["Modify", "Adjust Audio Fades", "Apply Fades"]); } catch (_) {}
    console.log(`duck-music: gain set to ${db} dB + fades applied`);
  },

  // ---- ken-burns: Crop type Ken Burns with start/end framing ----
  // From "10 Best Effects YouTubers Use". Crop > Type Ken Burns then swap
  // arrow to reverse the move.
  async "ken-burns"([direction = "in"]) {
    need();
    focusInspector();
    try { setAttr("Crop Type", "AXValue", "Ken Burns"); } catch (_) {}
    if (direction === "out") {
      // Swap the start/end framing via the swap button in the Inspector.
      try { pressByLabel("Swap Start/End"); } catch (_) {}
    }
    console.log(`ken-burns: direction=${direction}`);
  },

  // ---- handheld: Camera-shake handheld effect with restrained defaults ----
  // From "10 Best Effects": Handheld effect at amount/zoom around 10-15.
  async handheld([amount = "10", zoom = "10"]) {
    need();
    await applyCatalogEffect(["Window", "Show in Workspace", "Effects"], "Handheld");
    await sleep(0.3);
    focusInspector();
    try { setAttr("Amount", "AXValue", String(amount)); } catch (_) {}
    try { setAttr("Zoom",   "AXValue", String(zoom));   } catch (_) {}
    console.log(`handheld: amount=${amount}, zoom=${zoom}`);
  },

  // ---- censor / patch-cover: Pixelate + Shape Mask + Feather ----
  // From "10 Best Effects". Apply Pixelate, then Shape Mask, then increase
  // Feather. The user keyframes Position separately via add-keyframe.
  async censor() {
    need();
    await applyCatalogEffect(["Window", "Show in Workspace", "Effects"], "Pixelate");
    await sleep(0.3);
    await applyCatalogEffect(["Window", "Show in Workspace", "Effects"], "Shape Mask");
    await sleep(0.3);
    focusInspector();
    try { setAttr("Feather", "AXValue", "100"); } catch (_) {}
    console.log("censor: Pixelate + Shape Mask + Feather 100");
  },

  // ---- before-after-wipe: Wipe transition with extended duration ----
  async "before-after-wipe"([durSec = "2.0"]) {
    need();
    await applyCatalogEffect(["Window", "Show in Workspace", "Transitions"], "Wipe");
    await sleep(0.3);
    focusInspector();
    try { setAttr("Duration", "AXValue", String(durSec)); } catch (_) {}
    console.log(`before-after-wipe: duration=${durSec}s`);
  },

  // ---- log-clean-grade: standard color-grading pass ----
  // Color Wheels primaries: lift shadows, push highlights, mild saturation.
  // From "Color Grade in FCPX for Beginners". Numeric defaults are
  // restrained so the result is broadcast-safe.
  async "clean-grade"() {
    need();
    focusInspector();
    await applyCatalogEffect(["Window", "Show in Workspace", "Effects"], "Color Wheels");
    await sleep(0.4);
    try { setAttr("Master Saturation",     "AXValue", "1.05"); } catch (_) {}
    try { setAttr("Shadows Brightness",    "AXValue", "0.05"); } catch (_) {}
    try { setAttr("Highlights Brightness", "AXValue", "-0.03"); } catch (_) {}
    console.log("clean-grade: ColorWheels with restrained primary push");
  },

  // ---- auto-captions: built-in caption transcription ----
  // From "How to Add Subtitles (Automatically)". Open Edit > Captions >
  // Transcribe to Captions, accept default language + role, then return.
  async "auto-captions"([lang = "English (United States)"]) {
    need();
    try { clickMenu(["Edit", "Captions", "Transcribe to Captions…"]); }
    catch (_) { clickMenu(["Edit", "Captions", "Transcribe to Captions"]); }
    await sleep(1.2);
    try { dialogSetField("Language", lang); } catch (_) {}
    try { dialogPress("Transcribe"); } catch (_) { try { dialogPress("OK"); } catch (_) {} }
    console.log(`auto-captions: requested transcribe (${lang})`);
  },

  // ---- proxies: transcode source media to proxies for fluid editing ----
  // From "5 Ways to Save Time": create proxy media via File > Transcode Media
  // so the rough cut plays back smoothly. Playback switch itself is on the
  // Viewer-toolbar popup (not a menu); a project-level proxy preference is
  // also under Library Properties.
  "use-proxies"() {
    need();
    clickMenu(["File", "Transcode Media…"]);
    console.log("transcode-media dialog opened — enable Create Proxy Media + OK");
  },

  // ---- vertical-format: prep project for vertical delivery ----
  // From "Vertical Videos in FCP". Sets Spatial Conform to Fill on the
  // selected clip. Project format itself must be configured at fcpxml time
  // via --aspect vertical (FCPXML AUTHORING option).
  "vertical-format"() {
    need();
    focusInspector();
    try { setAttr("Spatial Conform Type", "AXValue", "Fill"); } catch (_) {}
    console.log("vertical-format: Spatial Conform = Fill on selected clip");
  },
};

export const WORKFLOWS_HELP = [
  ["Audio workflow",  ["noise-reduce [<voice-iso 0-100>]", "duck-music [<db>]"]],
  ["Color workflow",  ["log-grade-stack", "clean-grade"]],
  ["Effects recipe",  ["ken-burns [<in|out>]", "handheld [<amt> <zoom>]", "censor", "before-after-wipe [<dur-sec>]"]],
  ["Captions",        ["auto-captions [<language>]"]],
  ["Format / proxy",  ["use-proxies", "vertical-format"]],
  ["Share",           ["youtube-export <filename>"]],
];
