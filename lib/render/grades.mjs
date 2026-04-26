// Color-grading look library. Used by make-cut.mjs (FCPXML emission) and
// lib/render/video.mjs (bypass-ffmpeg renderer). Each look ships two
// renderings of the same intent: a native FCP filter-video param block,
// and an ffmpeg filter chain that approximates the look for the direct path.

import { spawnSync } from "node:child_process";

// Resource id for the Color Correction effect we declare once in the
// FCPXML resources block. Picked above the typical user-asset id range.
export const LOOK_EFFECT_ID = "rL1";
export const LOOK_EFFECT_DECL =
  `<effect id="${LOOK_EFFECT_ID}" name="Color Correction" uid="FFColorCorrectionEffect"/>`;

// Custom-LUT effect resource. FCP's "Custom LUT" effect uid is FFCustomLUT
// (observed in references/cutlass/test_color_correction.fcpxml). Emitted
// only when --lut=<path> is set so the resources block stays minimal.
export const LUT_EFFECT_ID = "rL2";
export const LUT_EFFECT_DECL =
  `<effect id="${LUT_EFFECT_ID}" name="Custom LUT" uid="FFCustomLUT"/>`;

// Build the FCP filter-video block for a Custom LUT. lutPath is a file://
// URL (or absolute path that we'll wrap) pointing at a .cube file FCP can
// load. The "URL" param key on FFCustomLUT is "1".
export function lutFcpFilter(lutPath) {
  const url = lutPath.startsWith("file://") ? lutPath : `file://${lutPath}`;
  return `<filter-video ref="${LUT_EFFECT_ID}" name="Custom LUT"><param name="URL" key="1" value="${url}"/></filter-video>`;
}

// Build the ffmpeg lut3d filter chain for a .cube LUT. ffmpeg accepts both
// .cube and .3dl directly via the lut3d filter.
export function lutFfmpegFilter(lutPath) {
  // Escape colons + backslashes in the path so they pass through
  // filtergraph parsing (Windows paths and macOS paths with colons).
  const esc = lutPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
  return `lut3d='${esc}'`;
}

// Build one FCP filter-video block from a list of {name, key, value} params.
// keys come from FCP's Color Correction parameter table observed in the
// references (key="2003" = color_shadow, "2011" = exposure_shadow, etc.).
function fcpFilter(params) {
  const inner = params.map((p) =>
    `<param name="${p.name}" key="${p.key}" value="${p.value}"/>`
  ).join("");
  return `<filter-video ref="${LOOK_EFFECT_ID}" name="Color Correction">${inner}</filter-video>`;
}

// FCP Color Correction parameter keys (from blockbuster-color.fcpxml).
const K = {
  exposure_shadow:    "2011",
  exposure_midtone:   "2009",
  exposure_highlight: "2007",
  color_shadow:       "2003",
  color_midtone:      "2002",
  color_highlight:    "2001",
  saturation_global:  "2014",
  saturation_midtone: "2015",
};

// Each look:
//   description — one-line summary
//   fcp         — FCP filter-video XML applied per clip
//   ffmpeg      — ffmpeg filter chain spliced into renderClips' per-clip path
export const LOOKS = {
  none: {
    description: "No grade. Pass-through.",
    fcp: "",
    ffmpeg: "",
  },
  cinematic: {
    description: "Teal-orange Hollywood. Shadows toward teal, midtones toward orange.",
    fcp: fcpFilter([
      { name: "color_shadow",       key: K.color_shadow,       value: "0.55 0.40" },
      { name: "color_midtone",      key: K.color_midtone,      value: "1.50 0.30" },
      { name: "color_highlight",    key: K.color_highlight,    value: "1.45 0.25" },
      { name: "exposure_shadow",    key: K.exposure_shadow,    value: "-0.10" },
      { name: "exposure_midtone",   key: K.exposure_midtone,   value: "0.05" },
      { name: "exposure_highlight", key: K.exposure_highlight, value: "0.03" },
      { name: "saturation_global",  key: K.saturation_global,  value: "1.12" },
    ]),
    ffmpeg: "colorbalance=rs=-0.08:gs=-0.04:bs=0.08:rm=0.10:bm=-0.05:rh=0.08:bh=-0.04,eq=saturation=1.15:gamma=0.96:contrast=1.10",
  },
  warm: {
    description: "Golden-hour. Push reds + yellows up, cool blues down.",
    fcp: fcpFilter([
      { name: "color_midtone",      key: K.color_midtone,      value: "1.65 0.20" },
      { name: "color_highlight",    key: K.color_highlight,    value: "1.55 0.15" },
      { name: "exposure_midtone",   key: K.exposure_midtone,   value: "0.04" },
      { name: "saturation_global",  key: K.saturation_global,  value: "1.08" },
    ]),
    ffmpeg: "colorbalance=rm=0.18:bm=-0.12:rh=0.12:bh=-0.10,eq=saturation=1.08:gamma=0.98",
  },
  cool: {
    description: "Overcast / moody. Blues up, reds down, slight desat.",
    fcp: fcpFilter([
      { name: "color_shadow",       key: K.color_shadow,       value: "0.45 0.55" },
      { name: "color_midtone",      key: K.color_midtone,      value: "0.50 0.55" },
      { name: "saturation_global",  key: K.saturation_global,  value: "0.92" },
    ]),
    ffmpeg: "colorbalance=rm=-0.08:bm=0.18:rh=-0.06:bh=0.12,eq=saturation=0.92:gamma=1.02",
  },
  vintage: {
    description: "Lifted blacks, faded curves, slight green tint.",
    fcp: fcpFilter([
      { name: "exposure_shadow",    key: K.exposure_shadow,    value: "0.18" },
      { name: "exposure_highlight", key: K.exposure_highlight, value: "-0.08" },
      { name: "color_midtone",      key: K.color_midtone,      value: "0.85 0.60" },
      { name: "saturation_global",  key: K.saturation_global,  value: "0.78" },
    ]),
    ffmpeg: "curves=preset=vintage,eq=saturation=0.85:contrast=0.92",
  },
  bw: {
    description: "Black and white with a contrast bump.",
    fcp: fcpFilter([
      { name: "saturation_global",  key: K.saturation_global,  value: "0.0" },
      { name: "exposure_shadow",    key: K.exposure_shadow,    value: "-0.05" },
    ]),
    ffmpeg: "hue=s=0,eq=contrast=1.18:gamma=0.98",
  },
  punch: {
    description: "High contrast + saturated. Action / sports / hooks.",
    fcp: fcpFilter([
      { name: "exposure_shadow",    key: K.exposure_shadow,    value: "-0.12" },
      { name: "exposure_highlight", key: K.exposure_highlight, value: "0.08" },
      { name: "saturation_global",  key: K.saturation_global,  value: "1.30" },
      { name: "saturation_midtone", key: K.saturation_midtone, value: "1.20" },
    ]),
    ffmpeg: "eq=contrast=1.28:saturation=1.30:gamma=0.94",
  },
};

// Run ffmpeg signalstats on the first clip. Returns {YAVG, UAVG, VAVG} where
// YAVG is mean luma 0-255, UAVG / VAVG are mean chroma 0-255 centered on 128.
// Falls back to a balanced default when ffmpeg isn't available.
export function probeStats(clipPath) {
  const r = spawnSync("ffmpeg", [
    "-hide_banner", "-nostats", "-i", clipPath,
    "-vf", "signalstats,metadata=mode=print:file=-",
    "-frames:v", "30", "-an", "-f", "null", "-",
  ], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const get = (k) => {
    const m = out.match(new RegExp(`lavfi\\.signalstats\\.${k}=([\\d.]+)`));
    return m ? parseFloat(m[1]) : NaN;
  };
  return {
    YAVG: get("YAVG"),
    UAVG: get("UAVG"),
    VAVG: get("VAVG"),
    SATAVG: get("SATAVG"),
  };
}

// Pick a look automatically from clip stats. Heuristic:
//   YAVG very low → punch (lift the shadows)
//   YAVG very high → cool (knock down highlights)
//   VAVG > UAVG by margin → footage already warm → cool to balance
//   UAVG > VAVG by margin → footage already cool → warm to balance
//   otherwise → cinematic (the safe default polish)
export function pickAutoLook(stats) {
  const { YAVG, UAVG, VAVG } = stats;
  if (!Number.isFinite(YAVG)) return "cinematic";
  if (YAVG < 60) return "punch";
  if (YAVG > 200) return "cool";
  if (Number.isFinite(UAVG) && Number.isFinite(VAVG)) {
    if (VAVG - UAVG > 8) return "cool";
    if (UAVG - VAVG > 8) return "warm";
  }
  return "cinematic";
}

export function resolveLook(name, firstClipPath) {
  if (name === "auto") {
    if (!firstClipPath) return { name: "cinematic", ...LOOKS.cinematic };
    const stats = probeStats(firstClipPath);
    const pick = pickAutoLook(stats);
    return { name: pick, stats, ...LOOKS[pick] };
  }
  if (!LOOKS[name]) throw new Error(`unknown look: ${name}. Available: ${Object.keys(LOOKS).join(", ")}`);
  return { name, ...LOOKS[name] };
}
