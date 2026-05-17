# final-cut-pro-agent

Auto-editor for **Final Cut Pro**. It analyses a folder of source clips and a
music track, makes the editorial decisions (cut grid, shot selection, grade,
B-roll, markers), and **authors a Final Cut Pro project** (`.fcpxml`) you open
and export from Final Cut Pro.

Final Cut Pro is the only renderer. There is no alternative export path — the
agent's job is to produce a correct FCP project and (where the GUI driver can
run) drive Final Cut Pro itself.

## Install

```bash
git clone https://github.com/lbartoszcze/final-cut-pro-agent.git
cd final-cut-pro-agent
npm install -g .   # puts `cut` on PATH
```

Requires:
- Node 20+
- Final Cut Pro (the renderer)
- ffmpeg/ffprobe — used only to *measure* source clips (loudness, motion,
  scene cuts, tempo) so the FCPXML carries correct decisions. No video is
  rendered with ffmpeg.

## Workflow

```bash
# 1. Author the Final Cut Pro project
cut fcpxml --clips=./footage --music=track.mp3 --bars=24 --style=cinematic \
           --look=cinematic --aspect=2.35:1 --fps=24 --out=cut.fcpxml

# 2. Open it in Final Cut Pro
cut fcp open cut.fcpxml

# 3. Export from Final Cut Pro (Share → Master File)
cut fcp cua-share "My Master"
```

`cut help` lists every flag. `cut help all` prints all topics.

## What the authored FCPXML carries

- `<library><event><project><sequence><spine>` wrapping the full edit
- One `<asset>` per source with an absolute `file://` media-rep URL so FCP
  re-locates media without prompting
- Beat-grid / section cadence (`--bpm`/`--bars`/`--style`, or `--music` for
  auto BPM + downbeat)
- Section-aware shot selection (`--smart-pick`), visual-continuity match
  cuts (`--match-cuts`), face-aware hook/chorus + reaction B-rolls
  (`--faces`, `--brolls`) on `lane="1"`
- FCP-native `FFColorCorrectionEffect` grade per clip (`--look`) and
  `FFCustomLUT` (`--lut`)
- `Cross Dissolve` transitions at section boundaries
- Per-clip `<adjust-volume>` level match toward `--audio-target` LUFS
- `dialogue` / `video` audio roles for stem export
- `<format>` driven by `--aspect` + `--fps`
- Auto chapter-markers + `--custom-markers`
- `--template=<ref.fcpxml>` borrows cadence + grade from an existing edit

## Driving Final Cut Pro

`cut fcp <subcmd>` proxies to the FCP driver:
- `cut fcp open <file>` — open a project/fcpxml in FCP (`open -a`)
- `cut fcp cua-init` / `cua-effect` / `cua-color-preset` / `cua-share` —
  background AX/cua driver for effects + Share/export

The cua/AX driver needs an input environment that permits GUI automation.
Where that is unavailable, use `cut fcp open` then export from FCP's UI.

## Layout

```
bin/
  cut.mjs        single-entry CLI (fcpxml / fcp / help)
  make-cut.mjs   authors the .fcpxml
  fcp.mjs        drives Final Cut Pro (AX + cua)
lib/
  edit.mjs       cadence / section / title planning
  fcpxml.mjs     FCPXML element builders
  fcp-ax.mjs / fcp-cua-cmds.mjs / fcp-cua.mjs   FCP GUI driver
  render/
    grades.mjs   FCP colour-grade look library
    template.mjs reference-fcpxml cadence/grade parser
    ffmpeg.mjs   ffprobe measurement helpers (loudness/aspect/fps for FCPXML)
  analyze/       beats / motion / score / faces — edit-decision intelligence
  source/sources.mjs   clip discovery + duration probe
```
