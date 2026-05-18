// Named wrappers turning the 574-command FCP menu catalog
// (references/fcp-menus.txt) into ergonomic CLI verbs.
//
// Every wrapper here dispatches through clickMenu / setAttr / dialogPress
// (osascript AX actions, no cursor / no keystroke / no screencapture).
// FCP can stay backgrounded.

import { clickMenu, isRunning } from "./fcp-ax.mjs";
import { dialogPress, dialogSetField } from "./fcp-ax-generic.mjs";

function need() {
  if (!isRunning()) throw new Error("Final Cut Pro is not running. `cut fcp launch` first.");
}

// One-line factory: returns a CMD function that clicks the given menu path
// and prints a confirmation.
function menu(path, label = path.join(" → ")) {
  return () => { need(); clickMenu(path); console.log(label); };
}

// One-line factory for a menu click + dialog-text + Save/OK confirmation.
// Used by Modify > Adjust Volume > Absolute… (asks for dB), Modify >
// Change Duration… (asks for timecode), Modify > Retime > Custom Speed…
// (asks for percent), etc.
function menuPrompt(path, fieldHint, confirmLabel = "OK") {
  return ([value]) => {
    if (value == null) throw new Error(`requires <${fieldHint || "value"}>`);
    need();
    clickMenu(path);
    // Modal dialog appears asynchronously; small wait, then fill + confirm.
    const start = Date.now();
    while (Date.now() - start < 2000) {
      try { dialogSetField(fieldHint, value); break; } catch (_) {}
    }
    dialogPress(confirmLabel);
    console.log(`${path.join(" → ")}: ${value}`);
  };
}

export const WRAPPERS = {
  // ---- Edit menu (clipboard + storyline + add) ----
  cut: menu(["Edit", "Cut"], "cut"),
  copy: menu(["Edit", "Copy"], "copy"),
  paste: menu(["Edit", "Paste"], "paste"),
  "paste-connected": menu(["Edit", "Paste as Connected Clip"]),
  "paste-effects": menu(["Edit", "Paste Effects"]),
  "remove-effects": menu(["Edit", "Remove Effects"]),
  delete: menu(["Edit", "Delete"]),
  "replace-gap": menu(["Edit", "Replace with Gap"]),
  "select-all": menu(["Edit", "Select All"]),
  "deselect-all": menu(["Edit", "Deselect All"]),
  "select-clip": menu(["Edit", "Select Clip"]),
  "select-next": menu(["Edit", "Select", "Select Next"]),
  "select-prev": menu(["Edit", "Select", "Select Previous"]),
  "select-above": menu(["Edit", "Select", "Select Above"]),
  "select-below": menu(["Edit", "Select", "Select Below"]),
  "duplicate-project": menu(["Edit", "Duplicate Project"]),
  "snapshot-project": menu(["Edit", "Snapshot Project"]),
  connect: menu(["Edit", "Connect to Primary Storyline"], "connect"),
  insert: menu(["Edit", "Insert"], "insert"),
  append: menu(["Edit", "Append to Storyline"], "append"),
  overwrite: menu(["Edit", "Overwrite"], "overwrite"),
  lift: menu(["Edit", "Lift from Storyline"]),
  collapse: menu(["Edit", "Collapse to Connected Storyline"]),
  "add-dissolve": menu(["Edit", "Add Cross Dissolve"]),
  "add-color": menu(["Edit", "Add Color Adjustment"]),
  "add-color-board": menu(["Edit", "Add Color Board"]),
  "add-eq": menu(["Edit", "Add Channel EQ"]),
  "add-adjustment": menu(["Edit", "Add Adjustment Clip"]),
  "add-title": menu(["Edit", "Connect Title"]),

  // ---- Trim menu ----
  blade: menu(["Trim", "Blade"], "blade"),
  "blade-all": menu(["Trim", "Blade All"]),
  "join-clips": menu(["Trim", "Join Clips"]),
  "trim-start": menu(["Trim", "Trim Start"]),
  "trim-end": menu(["Trim", "Trim End"]),
  "trim-to-selection": menu(["Trim", "Trim to Selection"]),
  "extend-edit": menu(["Trim", "Extend Edit"]),
  "align-audio": menu(["Trim", "Align Audio to Video"]),
  "nudge-left": menu(["Trim", "Nudge Left"]),
  "nudge-right": menu(["Trim", "Nudge Right"]),

  // ---- Modify > Adjust Volume ----
  "volume-up": menu(["Modify", "Adjust Volume", "Up (+1 dB)"]),
  "volume-down": menu(["Modify", "Adjust Volume", "Down (-1 dB)"]),
  "volume-silence": menu(["Modify", "Adjust Volume", "Silence (-∞)"]),
  "volume-reset": menu(["Modify", "Adjust Volume", "Reset (0dB)"]),
  "volume-absolute": menuPrompt(["Modify", "Adjust Volume", "Absolute…"], "dB"),
  "volume-relative": menuPrompt(["Modify", "Adjust Volume", "Relative…"], "dB"),

  // ---- Modify > Adjust Audio Fades ----
  "fade-crossfade": menu(["Modify", "Adjust Audio Fades", "Crossfade"]),
  "fade-apply": menu(["Modify", "Adjust Audio Fades", "Apply Fades"]),
  "fade-remove": menu(["Modify", "Adjust Audio Fades", "Remove Fades"]),
  "fade-in": menu(["Modify", "Adjust Audio Fades", "Fade In"]),
  "fade-out": menu(["Modify", "Adjust Audio Fades", "Fade Out"]),

  // ---- Modify > Retime ----
  "retime-slow": menu(["Modify", "Retime", "Slow"]),
  "retime-smooth": menu(["Modify", "Retime", "Smooth Slo-Mo"]),
  "retime-fast": menu(["Modify", "Retime", "Fast"]),
  "retime-normal": menu(["Modify", "Retime", "Normal (100%)"]),
  "retime-hold": menu(["Modify", "Retime", "Hold"]),
  "retime-blade": menu(["Modify", "Retime", "Blade Speed"]),
  "retime-custom": menuPrompt(["Modify", "Retime", "Custom Speed…"], "Rate"),
  "retime-reverse": menu(["Modify", "Retime", "Reverse Clip"]),
  "retime-reset": menu(["Modify", "Retime", "Reset Speed "]),
  "retime-auto": menu(["Modify", "Retime", "Automatic Speed"]),
  "speed-ramp": menu(["Modify", "Retime", "Speed Ramp"]),
  "instant-replay": menu(["Modify", "Retime", "Instant Replay"]),
  rewind: menu(["Modify", "Retime", "Rewind"]),
  "jump-cut-markers": menu(["Modify", "Retime", "Jump Cut at Markers"]),

  // ---- Modify > Color & Audio enhancement ----
  "enhance-color": menu(["Modify", "Enhance Light and Color"]),
  "balance-color": menu(["Modify", "Balance Color"]),
  "match-color": menu(["Modify", "Match Color…"]),
  "enhance-audio": menu(["Modify", "Enhance Audio"]),
  "match-audio": menu(["Modify", "Match Audio…"]),

  // ---- Modify > Analyze, render, duration ----
  "analyze-fix": menu(["Modify", "Analyze and Fix…"]),
  "render-all": menu(["Modify", "Render All"]),
  "render-selection": menu(["Modify", "Render Selection"]),
  "change-duration": menuPrompt(["Modify", "Change Duration…"], "Duration"),

  // ---- Clip menu ----
  "create-storyline": menu(["Clip", "Create Storyline"]),
  synchronize: menu(["Clip", "Synchronize Clips…"]),
  "open-clip": menu(["Clip", "Open Clip"]),
  "show-video-animation": menu(["Clip", "Show Video Animation"]),
  "show-audio-animation": menu(["Clip", "Show Audio Animation"]),
  "solo-animation": menu(["Clip", "Solo Animation"]),
  "show-tracking": menu(["Clip", "Show Tracking Editor"]),
  "show-mask": menu(["Clip", "Show Magnetic Mask Editor"]),
  "expand-audio": menu(["Clip", "Expand Audio"]),
  "expand-audio-components": menu(["Clip", "Expand Audio Components"]),
  "detach-audio": menu(["Clip", "Detach Audio"]),
  "break-apart": menu(["Clip", "Break Apart Clip Items"]),
  "enable-clip": menu(["Clip", "Enable"]),
  "rename-clip": menu(["Clip", "Rename Clip"]),
  solo: menu(["Clip", "Solo"]),

  // ---- Mark menu (range, rating, keywords, markers, navigation) ----
  "mark-in": menu(["Mark", "Set Range Start"]),
  "mark-out": menu(["Mark", "Set Range End"]),
  "set-clip-range": menu(["Mark", "Set Clip Range"]),
  "clear-ranges": menu(["Mark", "Clear Selected Ranges"]),
  favorite: menu(["Mark", "Favorite"]),
  "delete-rating": menu(["Mark", "Delete"]),
  unrate: menu(["Mark", "Unrate"]),
  "show-keywords": menu(["Mark", "Show Keyword Editor"]),
  "remove-keywords": menu(["Mark", "Remove All Keywords"]),
  "remove-analysis-keywords": menu(["Mark", "Remove All Analysis Keywords"]),
  "hide-clip": menu(["Mark", "Hide Clip"]),
  "add-marker": menu(["Mark", "Markers", "Add Marker"]),
  "add-marker-modify": menu(["Mark", "Markers", "Add Marker and Modify"]),
  "modify-marker": menu(["Mark", "Markers", "Modify Marker"]),
  "nudge-marker-left": menu(["Mark", "Markers", "Nudge Marker Left"]),
  "nudge-marker-right": menu(["Mark", "Markers", "Nudge Marker Right"]),
  "delete-marker": menu(["Mark", "Markers", "Delete Marker"]),
  "delete-markers-in-selection": menu(["Mark", "Markers", "Delete Markers in Selection"]),
  "go-range-start": menu(["Mark", "Go to", "Range Start"]),
  "go-range-end": menu(["Mark", "Go to", "Range End"]),
  "go-beginning": menu(["Mark", "Go to", "Beginning"]),
  "go-end": menu(["Mark", "Go to", "End"]),
  "prev-frame": menu(["Mark", "Previous", "Frame"]),
  "prev-edit": menu(["Mark", "Previous", "Edit"]),
  "prev-marker": menu(["Mark", "Previous", "Marker"]),
  "prev-keyframe": menu(["Mark", "Previous", "Keyframe"]),
  "next-frame": menu(["Mark", "Next", "Frame"]),
  "next-edit": menu(["Mark", "Next", "Edit"]),
  "next-marker": menu(["Mark", "Next", "Marker"]),
  "next-keyframe": menu(["Mark", "Next", "Keyframe"]),

  // ---- View > Playback + browser/viewer toggles ----
  play: menu(["View", "Playback", "Play"]),
  "play-selection": menu(["View", "Playback", "Play Selection"]),
  "play-around": menu(["View", "Playback", "Play Around"]),
  "play-from-beginning": menu(["View", "Playback", "Play from Beginning"]),
  "play-to-end": menu(["View", "Playback", "Play to End"]),
  "play-fullscreen": menu(["View", "Playback", "Play Full Screen"]),
  "loop-playback": menu(["View", "Playback", "Loop Playback"]),
  "toggle-inspector-height": menu(["View", "Toggle Inspector Height"]),

  // ---- File > New / Import / Export / Library ----
  "new-project": menu(["File", "New", "Project…"]),
  "new-event": menu(["File", "New", "Event…"]),
  "new-library": menu(["File", "New", "Library…"]),
  "new-folder": menu(["File", "New", "Folder"]),
  "new-keyword-collection": menu(["File", "New", "Keyword Collection"]),
  "new-smart-collection": menu(["File", "New", "Library Smart Collection"]),
  "new-compound": menu(["File", "New", "Compound Clip…"]),
  "new-multicam": menu(["File", "New", "Multicam Clip…"]),
  "open-library": menu(["File", "Open Library", "Other…"]),
  "open-library-backup": menu(["File", "Open Library", "From Backup…"]),
  "library-properties": menu(["File", "Library Properties"]),
  "import-media": menu(["File", "Import", "Media…"]),
  "import-xml": menu(["File", "Import", "XML…"]),
  "import-captions": menu(["File", "Import", "Captions…"]),
  "transcode-media": menu(["File", "Transcode Media…"]),
  "relink-original": menu(["File", "Relink Files", "Original Media…"]),
  "relink-proxy": menu(["File", "Relink Files", "Proxy Media…"]),
  "export-xml": menu(["File", "Export XML…"]),
  "export-captions": menu(["File", "Export Captions…"]),
  "send-to-compressor": menu(["File", "Send to Compressor"]),

  // ---- Window > Go To (focus a panel) ----
  "go-libraries": menu(["Window", "Go To", "Libraries"]),
  "go-photos": menu(["Window", "Go To", "Photos, Videos, and Audio"]),
  "go-titles": menu(["Window", "Go To", "Titles and Generators"]),
  "go-viewer": menu(["Window", "Go To", "Viewer"]),
  "go-event-viewer": menu(["Window", "Go To", "Event Viewer"]),
  "go-comparison-viewer": menu(["Window", "Go To", "Comparison Viewer"]),
  "go-timeline": menu(["Window", "Go To", "Timeline"]),
  "go-inspector": menu(["Window", "Go To", "Inspector"]),
  "go-color-inspector": menu(["Window", "Go To", "Color Inspector"]),
  "go-next-tab": menu(["Window", "Go To", "Next Tab"]),
  "go-prev-tab": menu(["Window", "Go To", "Previous Tab"]),

  // ---- Window > Show in Workspace (toggle panel visibility) ----
  "show-sidebar": menu(["Window", "Show in Workspace", "Sidebar"]),
  "show-browser": menu(["Window", "Show in Workspace", "Browser"]),
  "show-event-viewer": menu(["Window", "Show in Workspace", "Event Viewer"]),
  "show-comparison-viewer": menu(["Window", "Show in Workspace", "Comparison Viewer"]),
  "show-inspector": menu(["Window", "Show in Workspace", "Inspector"]),
  "show-timeline": menu(["Window", "Show in Workspace", "Timeline"]),
  "show-timeline-index": menu(["Window", "Show in Workspace", "Timeline Index"]),
  "show-audio-meters": menu(["Window", "Show in Workspace", "Audio Meters"]),
  "show-effects": menu(["Window", "Show in Workspace", "Effects"]),
  "show-transitions": menu(["Window", "Show in Workspace", "Transitions"]),

  // ---- Window > Workspaces ----
  "workspace-default": menu(["Window", "Workspaces", "Default"]),
  "workspace-organize": menu(["Window", "Workspaces", "Organize"]),
  "workspace-color": menu(["Window", "Workspaces", "Color & Effects"]),
  "workspace-dual": menu(["Window", "Workspaces", "Dual Displays"]),
  "save-workspace": menu(["Window", "Workspaces", "Save Workspace as…"]),
  "update-workspace": menu(["Window", "Workspaces", "Update Workspace"]),

  // ---- Window > top-level panels ----
  voiceover: menu(["Window", "Record Voiceover"]),
  "background-tasks": menu(["Window", "Background Tasks"]),
  "project-properties": menu(["Window", "Project Properties"]),
  "project-timecode": menu(["Window", "Project Timecode"]),
  "source-timecode": menu(["Window", "Source Timecode"]),
  "av-output": menu(["Window", "A/V Output"]),
  "vr-headset": menu(["Window", "Output to VR Headset"]),

  // ---- Final Cut Pro app menu ----
  about: menu(["Final Cut Pro", "About Final Cut Pro"]),
  settings: menu(["Final Cut Pro", "Settings…"]),
  "command-customize": menu(["Final Cut Pro", "Command Sets", "Customize…"]),
  "command-import": menu(["Final Cut Pro", "Command Sets", "Import…"]),
  "command-export": menu(["Final Cut Pro", "Command Sets", "Export…"]),
  "hide-fcp": menu(["Final Cut Pro", "Hide Final Cut Pro"]),
  "hide-others": menu(["Final Cut Pro", "Hide Others"]),
  "show-all": menu(["Final Cut Pro", "Show All"]),
  quit: menu(["Final Cut Pro", "Quit Final Cut Pro"], "quit"),
  "quit-keep-windows": menu(["Final Cut Pro", "Quit and Keep Windows"]),

  // ---- File > Share (one per preset; share <preset> remains generic) ----
  "share-default": menu(["File", "Share", "Export File (default)…"]),
  "share-720p": menu(["File", "Share", "Apple Devices 720p…"]),
  "share-1080p": menu(["File", "Share", "Apple Devices 1080p…"]),
  "share-4k": menu(["File", "Share", "Apple Devices 4K…"]),
  "share-social": menu(["File", "Share", "Social Platforms…"]),
  "share-hevc": menu(["File", "Share", "HEVC - High Efficiency Video…"]),
  "share-vision": menu(["File", "Share", "Apple Vision Pro (MV-HEVC)…"]),
};

// Names grouped by section for the help output. Each row: [group, names...]
export const WRAPPERS_HELP = [
  ["Edit / clipboard", ["cut", "copy", "paste", "paste-connected", "paste-effects", "remove-effects", "delete", "replace-gap", "select-all", "deselect-all", "select-clip", "select-next", "select-prev", "select-above", "select-below"]],
  ["Edit / storyline", ["connect", "insert", "append", "overwrite", "lift", "collapse", "duplicate-project", "snapshot-project"]],
  ["Edit / add",       ["add-dissolve", "add-color", "add-color-board", "add-eq", "add-adjustment", "add-title"]],
  ["Trim",             ["blade", "blade-all", "join-clips", "trim-start", "trim-end", "trim-to-selection", "extend-edit", "align-audio", "nudge-left", "nudge-right"]],
  ["Volume",           ["volume-up", "volume-down", "volume-silence", "volume-reset", "volume-absolute <dB>", "volume-relative <dB>"]],
  ["Audio fades",      ["fade-crossfade", "fade-apply", "fade-remove", "fade-in", "fade-out"]],
  ["Retime",           ["retime-slow", "retime-smooth", "retime-fast", "retime-normal", "retime-hold", "retime-blade", "retime-custom <rate>", "retime-reverse", "retime-reset", "retime-auto", "speed-ramp", "instant-replay", "rewind", "jump-cut-markers"]],
  ["Color / audio fx", ["enhance-color", "balance-color", "match-color", "enhance-audio", "match-audio"]],
  ["Modify misc",      ["analyze-fix", "render-all", "render-selection", "change-duration <tc>"]],
  ["Clip",             ["create-storyline", "synchronize", "open-clip", "show-video-animation", "show-audio-animation", "solo-animation", "show-tracking", "show-mask", "expand-audio", "expand-audio-components", "detach-audio", "break-apart", "enable-clip", "rename-clip", "solo"]],
  ["Mark / range",     ["mark-in", "mark-out", "set-clip-range", "clear-ranges"]],
  ["Mark / rating",    ["favorite", "delete-rating", "unrate"]],
  ["Mark / keywords",  ["show-keywords", "remove-keywords", "remove-analysis-keywords", "hide-clip"]],
  ["Markers",          ["add-marker", "add-marker-modify", "modify-marker", "nudge-marker-left", "nudge-marker-right", "delete-marker", "delete-markers-in-selection"]],
  ["Navigation",       ["go-range-start", "go-range-end", "go-beginning", "go-end", "prev-frame", "prev-edit", "prev-marker", "prev-keyframe", "next-frame", "next-edit", "next-marker", "next-keyframe"]],
  ["Playback",         ["play", "play-selection", "play-around", "play-from-beginning", "play-to-end", "play-fullscreen", "loop-playback", "toggle-inspector-height"]],
  ["File / library",   ["new-project", "new-event", "new-library", "new-folder", "new-keyword-collection", "new-smart-collection", "new-compound", "new-multicam", "open-library", "open-library-backup", "library-properties"]],
  ["File / import",    ["import-media", "import-xml", "import-captions", "transcode-media", "relink-original", "relink-proxy"]],
  ["File / export",    ["export-xml", "export-captions", "send-to-compressor"]],
  ["Share presets",    ["share-default", "share-720p", "share-1080p", "share-4k", "share-social", "share-hevc", "share-vision"]],
  ["Window / focus",   ["go-libraries", "go-photos", "go-titles", "go-viewer", "go-event-viewer", "go-comparison-viewer", "go-timeline", "go-inspector", "go-color-inspector", "go-next-tab", "go-prev-tab"]],
  ["Window / panels",  ["show-sidebar", "show-browser", "show-event-viewer", "show-comparison-viewer", "show-inspector", "show-timeline", "show-timeline-index", "show-audio-meters", "show-effects", "show-transitions"]],
  ["Workspaces",       ["workspace-default", "workspace-organize", "workspace-color", "workspace-dual", "save-workspace", "update-workspace"]],
  ["Window / misc",    ["voiceover", "background-tasks", "project-properties", "project-timecode", "source-timecode", "av-output", "vr-headset"]],
  ["App",              ["about", "settings", "command-customize", "command-import", "command-export", "hide-fcp", "hide-others", "show-all", "quit", "quit-keep-windows"]],
];
