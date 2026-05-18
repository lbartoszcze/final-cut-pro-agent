// Second wave of menu-bar named wrappers — covers submenus not yet wrapped
// in lib/fcp-wrappers.mjs (which is at the 300-line cap).
//
// Same non-capturing contract: every dispatch is a single clickMenu via
// osascript Accessibility actions on Final Cut Pro. No cursor, no
// keystrokes, no screencapture, no focus steal.

import { clickMenu, isRunning } from "../fcp-ax.mjs";

function need() {
  if (!isRunning()) throw new Error("Final Cut Pro is not running. `cut fcp launch` first.");
}

function menu(path, label = path.join(" → ")) {
  return () => { need(); clickMenu(path); console.log(label); };
}

export const EXTRA = {
  // ---- Edit > Keyframes ----
  "kf-cut": menu(["Edit", "Keyframes", "Cut"]),
  "kf-copy": menu(["Edit", "Keyframes", "Copy"]),
  "kf-paste": menu(["Edit", "Keyframes", "Paste"]),
  "kf-delete": menu(["Edit", "Keyframes", "Delete"]),

  // ---- Edit > Track ----
  "track-transform": menu(["Edit", "Track", "Object Transform"]),
  "track-shape-mask": menu(["Edit", "Track", "Effect Shape Mask"]),
  "track-color-mask": menu(["Edit", "Track", "Color Correction Shape Mask"]),

  // ---- Edit > Source Media ----
  "source-all": menu(["Edit", "Source Media", "All"]),
  "source-video": menu(["Edit", "Source Media", "Video Only"]),
  "source-audio": menu(["Edit", "Source Media", "Audio Only"]),

  // ---- Modify > Apply Custom Name ----
  "name-date": menu(["Modify", "Apply Custom Name", "Clip Date/Time"]),
  "name-counter": menu(["Modify", "Apply Custom Name", "Custom Name with Counter"]),
  "name-camera": menu(["Modify", "Apply Custom Name", "Original Name from Camera"]),
  "name-scene-shot": menu(["Modify", "Apply Custom Name", "Scene/Shot/Take/Angle"]),
  "name-edit": menu(["Modify", "Apply Custom Name", "Edit…"]),
  "name-new": menu(["Modify", "Apply Custom Name", "New…"]),

  // ---- Modify > Assign Roles ----
  "edit-audio-roles": menu(["Modify", "Assign Audio Roles", "Edit Roles…"]),
  "edit-video-roles": menu(["Modify", "Assign Video Roles", "Edit Roles…"]),
  "edit-caption-roles": menu(["Modify", "Assign Caption Roles", "Edit Roles…"]),
  "edit-roles": menu(["Modify", "Edit Roles…"]),

  // ---- Clip > Audition ----
  "audition-open": menu(["Clip", "Audition", "Open"]),
  "audition-preview": menu(["Clip", "Audition", "Preview"]),
  "audition-create": menu(["Clip", "Audition", "Create"]),
  "audition-duplicate": menu(["Clip", "Audition", "Duplicate as Audition"]),
  "audition-duplicate-original": menu(["Clip", "Audition", "Duplicate from Original"]),
  "audition-next": menu(["Clip", "Audition", "Next Pick"]),
  "audition-prev": menu(["Clip", "Audition", "Previous Pick"]),
  "audition-finalize": menu(["Clip", "Audition", "Finalize Audition"]),
  "audition-replace-add": menu(["Clip", "Audition", "Replace and add to Audition"]),
  "audition-add": menu(["Clip", "Audition", "Add to Audition"]),

  // ---- View > Browser (clip browser display) ----
  "browser-toggle-view": menu(["View", "Browser", "Toggle Filmstrip/List View"]),
  "browser-clip-name-size": menu(["View", "Browser", "Clip Name Size"]),
  "browser-clip-names": menu(["View", "Browser", "Clip Names"]),
  "browser-waveforms": menu(["View", "Browser", "Waveforms"]),
  "browser-show-hidden": menu(["View", "Browser", "Show Hidden Clips"]),
  "browser-marked-ranges": menu(["View", "Browser", "Marked Ranges"]),
  "browser-used-ranges": menu(["View", "Browser", "Used Media Ranges"]),
  "browser-skimmer-info": menu(["View", "Browser", "Skimmer Info"]),
  "browser-continuous-playback": menu(["View", "Browser", "Continuous Playback"]),

  // ---- View > Show in Viewer (overlays + scopes) ----
  "viewer-angles": menu(["View", "Show in Viewer", "Angles"]),
  "viewer-360": menu(["View", "Show in Viewer", "360°"]),
  "viewer-scopes": menu(["View", "Show in Viewer", "Video Scopes"]),
  "viewer-both-fields": menu(["View", "Show in Viewer", "Both Fields"]),
  "viewer-safe-zones": menu(["View", "Show in Viewer", "Title/Action Safe Zones"]),
  "viewer-overlay": menu(["View", "Show in Viewer", "Show Custom Overlay"]),
  "viewer-choose-overlay": menu(["View", "Show in Viewer", "Choose Custom Overlay"]),
  "viewer-color-channels": menu(["View", "Show in Viewer", "Color Channels"]),

  // ---- View > Timeline Index ----
  "index-clips": menu(["View", "Timeline Index", "Clips"]),
  "index-tags": menu(["View", "Timeline Index", "Tags"]),
  "index-roles": menu(["View", "Timeline Index", "Roles"]),
  "index-captions": menu(["View", "Timeline Index", "Captions"]),

  // ---- View > Sort Library Events By ----
  "sort-date": menu(["View", "Sort Library Events By", "Date"]),
  "sort-name": menu(["View", "Sort Library Events By", "Name"]),
  "sort-ascending": menu(["View", "Sort Library Events By", "Ascending"]),
  "sort-descending": menu(["View", "Sort Library Events By", "Descending"]),

  // ---- Modify > Add Keyframe (animation editor) ----
  "add-keyframe": menu(["Modify", "Add Keyframe to Selected Effect in Animation Editor"]),
};

export const EXTRA_HELP = [
  ["Edit / keyframes", ["kf-cut", "kf-copy", "kf-paste", "kf-delete"]],
  ["Edit / track",     ["track-transform", "track-shape-mask", "track-color-mask"]],
  ["Edit / source",    ["source-all", "source-video", "source-audio"]],
  ["Apply name",       ["name-date", "name-counter", "name-camera", "name-scene-shot", "name-edit", "name-new"]],
  ["Roles",            ["edit-audio-roles", "edit-video-roles", "edit-caption-roles", "edit-roles"]],
  ["Audition",         ["audition-open", "audition-preview", "audition-create", "audition-duplicate", "audition-duplicate-original", "audition-next", "audition-prev", "audition-finalize", "audition-replace-add", "audition-add"]],
  ["Browser display",  ["browser-toggle-view", "browser-clip-name-size", "browser-clip-names", "browser-waveforms", "browser-show-hidden", "browser-marked-ranges", "browser-used-ranges", "browser-skimmer-info", "browser-continuous-playback"]],
  ["Viewer overlays",  ["viewer-angles", "viewer-360", "viewer-scopes", "viewer-both-fields", "viewer-safe-zones", "viewer-overlay", "viewer-choose-overlay", "viewer-color-channels"]],
  ["Timeline index",   ["index-clips", "index-tags", "index-roles", "index-captions"]],
  ["Library sort",     ["sort-date", "sort-name", "sort-ascending", "sort-descending"]],
  ["Keyframe (anim)",  ["add-keyframe"]],
];
