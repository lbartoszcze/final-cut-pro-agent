#!/usr/bin/env node
// Single-entry CLI for final-cut-pro-agent.
//
//   cut render <flags>   → ffmpeg pipeline, writes a finished mp4 / mov
//   cut fcpxml <flags>   → writes a .fcpxml ready to open in Final Cut Pro
//   cut fcp <subcmd>     → drives a running FCP via AX + cliclick / cua
//   cut help [<topic>]   → flag reference (--all to print everything)

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const RENDER = join(ROOT, "lib", "render", "video.mjs");
const FCPXML = join(HERE, "make-cut.mjs");
const FCP = join(HERE, "fcp.mjs");

const HELP_TOPICS = {
  basic: [
    "--clips=<folder>         folder of .mp4/.mov source clips (else: test patterns)",
    "--out=<path>             output path",
    "--bars=<N>               number of musical bars (default 16)",
    "--bpm=<N>                BPM (default 140; ignored when --music is set)",
    "--style=montage|cinematic|jump-cut|slow-mo  cadence preset",
  ],
  audio: [
    "--music=<path>           music track — auto BPM + downbeat detect, ducked under dialogue",
    "--music-mix=1|0          1 = blend ducked, 0 = replace (default 1)",
    "--audio-target=<LUFS>    per-clip loudness target (default -16, off=disable)",
    "--audio-fade=<sec>       per-clip in/out fade (default 0.05)",
    "--jcut=<sec>             audio leads picture into the next segment by N sec",
    "--lcut=<sec>             audio lags into the next segment by N sec",
    "--denoise=1|0            FFT denoise on every clip's audio (default off)",
    "--limit=1|0              brick-wall limiter (default on)",
    "--highpass=<Hz>          high-pass filter at frequency (e.g. 80 for hum)",
    "--eq-bass=<dB> --eq-mid=<dB> --eq-treble=<dB>   3-band EQ per clip",
    "--sfx=<path> --sfx-gain=<dB>   one-shot SFX at every section boundary",
    "--snap-to-audio=1|<path>  snap cut times to source-audio onsets",
  ],
  picture: [
    "--look=cinematic|warm|cool|vintage|bw|punch|auto  preset grade",
    "--lut=<path.cube>        custom 3D LUT applied per clip",
    "--vignette=<0..1>        edge darkening",
    "--grain=<0..100>         temporal film grain",
    "--sharpen=<0..1.5>       unsharp mask",
    "--stabilize=1|0          two-pass libvidstab on each source (cached)",
    "--chromakey=<spec>       green / blue / hex chroma key",
    "--lumakey=<0..1>         luma threshold key",
    "--smart-pick=1|0         section-aware shot selection (default on)",
    "--match-cuts=1|0         visual continuity bias on adjacent cuts (default on)",
    "--faces=1|0              haarcascade face detection — biases hook+chorus to faces",
    "--brolls=1|0             chorus-section B-roll cutaways on lane=1",
  ],
  format: [
    "--aspect=<w:h[:fit|fill]>  16:9 / 9:16 / 1:1 / 4:5 / 2.35:1 / <w>x<h>",
    "--fps=<rate>             23.976 / 24 / 25 / 29.97 / 30 / 50 / 59.94 / 60",
    "--codec=h264|h265|prores",
    "--max-duration=<sec>     hard length cap",
    "--platform=<name>        tiktok / reels / youtube-shorts / instagram-feed / broadcast / cinema",
  ],
  story: [
    "--hook-sec=<sec>         opening high-motion window (default 3.5)",
    "--establishing=<sec>     prepend a low-motion wide shot opener",
    "--fade-from-black=<sec> / --fade-to-black=<sec>   edge fades",
  ],
  titles: [
    "--lower-third=\"<text>\"   speaker / role banner at bottom-left",
    "--end-card=\"<text>\"      closing centred title for last 3 s",
    "--logo=<path.png> --logo-pos=tl|tr|bl|br --logo-scale=<frac>   persistent watermark",
    "--captions=auto|off --caption-model=tiny.en|small.en|... --caption-lang=en   whisper transcription",
    "--auto-chapters=1|0      chapter markers at section boundaries",
    "--custom-markers=\"t:lbl,t:lbl,...\"   user-defined markers",
  ],
  composition: [
    "--pip=<path> --pip-pos=tl|tr|bl|br --pip-scale=<frac>   picture-in-picture inset",
    "--template=<path.fcpxml>  borrow cadence from a reference edit",
  ],
};

function printHelp(topic) {
  console.log("cut — final-cut-pro-agent unified CLI\n");
  console.log("USAGE:");
  console.log("  cut render <flags>   build the finished mp4 / mov directly");
  console.log("  cut fcpxml <flags>   build a .fcpxml for Final Cut Pro");
  console.log("  cut fcp <subcmd>     drive a running FCP via AX / cliclick");
  console.log("  cut help [topic]     this help (topic: " + Object.keys(HELP_TOPICS).join(", ") + ", or 'all')\n");
  const topics = topic === "all" || !topic ? Object.keys(HELP_TOPICS) : (HELP_TOPICS[topic] ? [topic] : Object.keys(HELP_TOPICS));
  for (const t of topics) {
    console.log(`[${t}]`);
    for (const l of HELP_TOPICS[t]) console.log("  " + l);
    console.log("");
  }
  console.log("EXAMPLES:");
  console.log("  cut render --clips=./footage --music=track.mp3 --platform=tiktok --captions=auto --out=tiktok.mp4");
  console.log("  cut fcpxml --clips=./footage --music=track.mp3 --bars=24 --style=cinematic --out=cut.fcpxml");
  console.log("  cut render --clips=./footage --codec=prores --aspect=16:9 --out=master.mov   # FCP-ready master\n");
}

function runNode(script, rest) {
  const c = spawn("node", [script, ...rest], { stdio: "inherit" });
  c.on("exit", (code) => process.exit(code || 0));
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  printHelp(rest[0]);
  process.exit(0);
}
if (cmd === "render") runNode(RENDER, rest);
else if (cmd === "fcpxml") runNode(FCPXML, rest);
else if (cmd === "fcp") runNode(FCP, rest);
else {
  console.error(`unknown subcommand: ${cmd}. Try 'cut help'.`);
  process.exit(2);
}
