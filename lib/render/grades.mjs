// FCP colour-grade look library. Each look is a native Final Cut Pro
// filter-video param block (FFColorCorrectionEffect) emitted into the
// FCPXML per clip. The auto-look picker uses ffprobe signalstats only to
// CHOOSE which FCP grade to apply — the grade itself is always FCP-native.

import { spawnSync } from "node:child_process";

// Resource id for the Color Correction effect declared once in the FCPXML
// <resources> block.
export const LOOK_EFFECT_ID = "rL1";
export const LOOK_EFFECT_DECL =
  `<effect id="${LOOK_EFFECT_ID}" name="Color Correction" uid="FFColorCorrectionEffect"/>`;

// FCP "Custom LUT" effect (uid FFCustomLUT). Emitted only when --lut is set.
export const LUT_EFFECT_ID = "rL2";
export const LUT_EFFECT_DECL =
  `<effect id="${LUT_EFFECT_ID}" name="Custom LUT" uid="FFCustomLUT"/>`;

// FCP filter-video block for a Custom LUT. The URL param key is "1".
export function lutFcpFilter(lutPath) {
  const url = lutPath.startsWith("file://") ? lutPath : `file://${lutPath}`;
  return `<filter-video ref="${LUT_EFFECT_ID}" name="Custom LUT"><param name="URL" key="1" value="${url}"/></filter-video>`;
}

// One FCP filter-video block from {name,key,value} params. keys come from
// FCP's Color Correction parameter table observed in the reference fcpxmls.
function fcpFilter(params) {
  const inner = params.map((p) =>
    `<param name="${p.name}" key="${p.key}" value="${p.value}"/>`
  ).join("");
  return `<filter-video ref="${LOOK_EFFECT_ID}" name="Color Correction">${inner}</filter-video>`;
}

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

// Each look ships only its FCP filter-video XML (applied per clip in the
// emitted FCPXML project).
export const LOOKS = {
  none: { description: "No grade. Pass-through.", fcp: "" },
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
  },
  warm: {
    description: "Golden-hour. Push reds + yellows up, cool blues down.",
    fcp: fcpFilter([
      { name: "color_midtone",      key: K.color_midtone,      value: "1.65 0.20" },
      { name: "color_highlight",    key: K.color_highlight,    value: "1.55 0.15" },
      { name: "exposure_midtone",   key: K.exposure_midtone,   value: "0.04" },
      { name: "saturation_global",  key: K.saturation_global,  value: "1.08" },
    ]),
  },
  cool: {
    description: "Overcast / moody. Blues up, reds down, slight desat.",
    fcp: fcpFilter([
      { name: "color_shadow",       key: K.color_shadow,       value: "0.45 0.55" },
      { name: "color_midtone",      key: K.color_midtone,      value: "0.50 0.55" },
      { name: "saturation_global",  key: K.saturation_global,  value: "0.92" },
    ]),
  },
  vintage: {
    description: "Lifted blacks, faded curves, slight green tint.",
    fcp: fcpFilter([
      { name: "exposure_shadow",    key: K.exposure_shadow,    value: "0.18" },
      { name: "exposure_highlight", key: K.exposure_highlight, value: "-0.08" },
      { name: "color_midtone",      key: K.color_midtone,      value: "0.85 0.60" },
      { name: "saturation_global",  key: K.saturation_global,  value: "0.78" },
    ]),
  },
  bw: {
    description: "Black and white with a contrast bump.",
    fcp: fcpFilter([
      { name: "saturation_global",  key: K.saturation_global,  value: "0.0" },
      { name: "exposure_shadow",    key: K.exposure_shadow,    value: "-0.05" },
    ]),
  },
  punch: {
    description: "High contrast + saturated. Action / sports / hooks.",
    fcp: fcpFilter([
      { name: "exposure_shadow",    key: K.exposure_shadow,    value: "-0.12" },
      { name: "exposure_highlight", key: K.exposure_highlight, value: "0.08" },
      { name: "saturation_global",  key: K.saturation_global,  value: "1.30" },
      { name: "saturation_midtone", key: K.saturation_midtone, value: "1.20" },
    ]),
  },
};

// ffprobe signalstats on the first clip — used ONLY to auto-pick which FCP
// grade to emit. {YAVG mean luma, UAVG/VAVG mean chroma, SATAVG}.
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
  return { YAVG: get("YAVG"), UAVG: get("UAVG"), VAVG: get("VAVG"), SATAVG: get("SATAVG") };
}

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
