// Argument defaults + platform-preset merge for the direct video renderer.
// Extracted from lib/render/video.mjs so that file stays under the 300-line
// cap as new pipeline stages land.

import { resolvePlatform } from "../render/ffmpeg.mjs";

export function defaultArgs(rootDir) {
  return {
    mode: "test-pattern", style: "montage", bpm: "140", bars: "16", clips: "",
    out: `${rootDir}/cut-rendered.mp4`, template: "", look: "cinematic",
    "audio-target": "-16", "audio-fade": "0.05",
    aspect: "16:9", fps: "29.97",
    "fade-from-black": "0", "fade-to-black": "0", "max-duration": "",
    lut: "", platform: "", vignette: "0", grain: "0", sharpen: "0",
    music: "", "music-mix": "1",
    "smart-pick": "1", "hook-sec": "3.5", "match-cuts": "1", faces: "0",
    brolls: "0", establishing: "0",
    captions: "off", "caption-model": "small.en", "caption-lang": "en",
    stabilize: "0", speed: "1",
    jcut: "0", lcut: "0",
    "lower-third": "", "end-card": "",
    logo: "", "logo-pos": "tr", "logo-scale": "0.1",
    denoise: "0", limit: "1", highpass: "0",
    chromakey: "", lumakey: "",
    pip: "", "pip-pos": "br", "pip-scale": "0.25", "pip-blend": "",
    codec: "h264",
    "eq-bass": "0", "eq-mid": "0", "eq-treble": "0",
    sfx: "", "sfx-gain": "0",
    "snap-to-audio": "",
    transform: "", mask: "",
    "vo-record": "", vo: "", "vo-at": "0",
    multicam: "0",
    freeze: "", colorspace: "",
    split: "", "music-folder": "", bitrate: "",
    "lens-flare": "0", "lens-correct": "",
    font: "", version: "",
    "multiband-comp": "0", "mcompand-spec": "",
    surround: "", hdr: "", ramp: "",
  };
}

export function parseArgs(argv, rootDir) {
  const defaults = defaultArgs(rootDir);
  const supplied = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.+)$/);
    if (m) supplied[m[1]] = m[2];
  }
  const out = { ...defaults, ...supplied };
  if (supplied.platform) {
    const p = resolvePlatform(supplied.platform);
    if (p) {
      if (!("audio-target" in supplied) && p.audioTarget != null) out["audio-target"] = String(p.audioTarget);
      if (!("max-duration" in supplied) && p.maxDuration != null) out["max-duration"] = String(p.maxDuration);
      if (!("aspect" in supplied) && p.aspect) out.aspect = p.aspect;
      if (!("fps" in supplied) && p.fps) out.fps = p.fps;
    }
  }
  if (out.clips) out.mode = "clips";
  return out;
}
