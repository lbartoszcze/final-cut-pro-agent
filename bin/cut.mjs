#!/usr/bin/env node
// Single-entry CLI for final-cut-pro-agent. Final Cut Pro is the only
// renderer — this tool authors the FCP project and (where the GUI driver
// is available) drives FCP itself. There is no non-FCP render path.
//
//   cut fcpxml <flags>   → author a Final Cut Pro project (.fcpxml)
//   cut fcp <subcmd>     → drive Final Cut Pro (open / effects / Share)
//   cut help [<topic>]   → flag reference

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const FCPXML = join(HERE, "make-cut.mjs");
const FCP = join(HERE, "fcp.mjs");

const HELP_TOPICS = {
  basic: [
    "--clips=<folder>         folder of source clips (referenced by the FCP project)",
    "--out=<path.fcpxml>      output FCPXML path (default cut.fcpxml)",
    "--bars=<N>               number of musical bars (default 16)",
    "--bpm=<N>                BPM (default 140; ignored when --music is set)",
    "--style=montage|cinematic|jump-cut|slow-mo  cadence preset",
    "--music=<path>           music track — auto BPM + downbeat detect drive the cut grid",
    "--template=<path.fcpxml> borrow cadence + grade from a reference FCP edit",
  ],
  picture: [
    "--look=cinematic|warm|cool|vintage|bw|punch|auto  FCP Color-Correction grade per clip",
    "--lut=<path.cube>        FCP Custom-LUT effect per clip",
    "--smart-pick=1|0         section-aware shot selection (default on)",
    "--match-cuts=1|0         visual-continuity bias on adjacent cuts (default on)",
    "--faces=1|0              face detection biases hook + chorus to faces",
    "--brolls=1|0             chorus-section B-roll cutaways on lane=1 (default on)",
    "--hook-sec=<sec>         opening high-motion window (default 3.5)",
  ],
  format: [
    "--aspect=<w:h>           16:9 / 9:16 / 1:1 / 4:5 / 2.35:1 — sets FCPXML <format>",
    "--fps=<rate>             23.976 / 24 / 25 / 29.97 / 30 / 50 / 59.94 / 60",
    "--max-duration=<sec>     hard length cap on the timeline",
    "--platform=<name>        tiktok / reels / youtube-shorts / broadcast / cinema preset",
    "--audio-target=<LUFS>    per-clip <adjust-volume> level match target (default -16)",
    "--audio-fade=<sec>       per-clip in/out fade (default 0.05)",
  ],
  markers: [
    "--auto-chapters=1|0      chapter-markers at section boundaries (default on)",
    "--custom-markers=\"t:lbl,t:lbl,...\"   user-defined timeline markers",
  ],
  fcp: [
    "cut fcp open <file>      open a project / fcpxml in Final Cut Pro",
    "cut fcp cua-init         prime the background FCP driver",
    "cut fcp cua-effect <n>   apply an effect by name",
    "cut fcp cua-color-preset <n>   apply a colour preset",
    "cut fcp cua-share <name> Share → Master File (export)",
    "  (the cua / AX driver requires an unrestricted input environment)",
  ],
};

function printHelp(topic) {
  console.log("cut — final-cut-pro-agent\n");
  console.log("Final Cut Pro is the only renderer. This tool authors the FCP");
  console.log("project and drives FCP; it never produces video any other way.\n");
  console.log("USAGE:");
  console.log("  cut fcpxml <flags>   author a Final Cut Pro project (.fcpxml)");
  console.log("  cut fcp <subcmd>     drive Final Cut Pro (open / effects / Share)");
  console.log("  cut help [topic]     this help (topic: " + Object.keys(HELP_TOPICS).join(", ") + ", or 'all')\n");
  const topics = topic === "all" || !topic ? Object.keys(HELP_TOPICS) : (HELP_TOPICS[topic] ? [topic] : Object.keys(HELP_TOPICS));
  for (const t of topics) {
    console.log(`[${t}]`);
    for (const l of HELP_TOPICS[t]) console.log("  " + l);
    console.log("");
  }
  console.log("WORKFLOW:");
  console.log("  1. cut fcpxml --clips=./footage --music=track.mp3 --bars=24 --style=cinematic --out=cut.fcpxml");
  console.log("  2. cut fcp open cut.fcpxml          # import into Final Cut Pro");
  console.log("  3. cut fcp cua-share \"My Master\"     # Share → Master File from FCP\n");
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
if (cmd === "fcpxml") runNode(FCPXML, rest);
else if (cmd === "fcp") runNode(FCP, rest);
else {
  console.error(`unknown subcommand: ${cmd}. Final Cut Pro is the only renderer — try 'cut help'.`);
  process.exit(2);
}
