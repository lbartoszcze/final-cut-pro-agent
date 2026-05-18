# final-cut-pro-agent

Auto-editor that authors a **Final Cut Pro project** (`.fcpxml`) and drives
**Final Cut Pro** via macOS Accessibility actions. Final Cut Pro is the only
renderer.

## Install

```bash
git clone https://github.com/lbartoszcze/final-cut-pro-agent.git
cd final-cut-pro-agent
npm install -g .   # puts `cut` on PATH
```

Requires:
- Node 20+
- Final Cut Pro
- ffmpeg/ffprobe — used only to *measure* source clips (loudness, motion,
  scene cuts, tempo) so the FCPXML carries correct decisions. No video is
  rendered with ffmpeg.

First-time use: macOS will prompt to grant Accessibility + Automation
permission for "Final Cut Pro" and "System Events" to the controlling
terminal. Grant it in Settings → Privacy & Security.

## What the driver covers

`cut fcp` is a **non-capturing driver** for Final Cut Pro: every command
dispatches through `osascript` Accessibility actions on the FCP process tree.

It does NOT:
- warp the cursor (no `cliclick`)
- type to the frontmost app (no `keystroke "..."`)
- grab the screen (no `screencapture`)
- steal focus (no `activate` / `AXRaise` / `frontmost set`)

FCP stays backgrounded while the driver works.

### Coverage

- **574 menu commands** reachable. All addressable via `cut fcp menu <Top> [Sub...] <Leaf>`.
  Catalog persisted at `references/fcp-menus.txt`; reproduce live with
  `cut fcp menus`.
- **288 named wrappers** for the highest-frequency operations — grouped help
  via `cut fcp wrappers`. Breakdown:
  - 197 menu wrappers (Edit / Trim / Modify / Clip / Mark / View / File / Share / Window / App)
  - 56 submenu wrappers (Keyframes / Track / Source Media / Apply Name / Roles / Audition / Browser / Viewer / Index / Sort)
  - 27 Inspector setters + complete-Share flow
  - 8 catalog-apply + status readers
- **6 universal AX primitives** reach any AXDescription-addressable element:
  `ax-get`, `ax-set`, `ax-press`, `select`, `dialog-button`, `dialog-set`.

### What is NOT covered (macOS Accessibility limitations)

These require mouse-gesture or pixel-coordinate input, which the user's
no-cursor-warp / no-screencapture constraint forbids:
- Drag-to-trim handles, drag-to-lane reparenting, drag-to-Inspector keyframe
  drop, click-and-drag in Color Wheels / Curves
- Painting masks in the viewer with the brush tool
- Anything that depends on physical cursor position

Everything else FCP exposes through macOS Accessibility is reachable.

## Workflow

```bash
# 1. Author the Final Cut Pro project (cut decisions baked in)
cut fcpxml --clips=./footage --music=track.mp3 --bars=24 --style=cinematic \
           --look=cinematic --aspect=2.35:1 --fps=24 --out=cut.fcpxml

# 2. Open it in Final Cut Pro (background, doesn't steal focus)
cut fcp open cut.fcpxml

# 3. Drive FCP from the CLI (any of the 288 named wrappers + 574 menu paths)
cut fcp volume-up                 # Modify > Adjust Volume > Up (+1 dB)
cut fcp apply-effect "Vignette"   # search + apply from Effects browser
cut fcp set-opacity 50            # Inspector Compositing > Opacity
cut fcp add-marker                # Mark > Markers > Add Marker
cut fcp menu File "Share" "Export File (default)…"   # any menu path

# 4. Complete the multi-step Share dialog without a mouse
cut fcp export "Export File (default)…" "MyCut"
```

`cut fcp help` shows the base commands; `cut fcp wrappers` lists all
288 named operations grouped by section; `cut fcp menus` enumerates every
menu-bar-reachable command.

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

## Layout

```
bin/
  cut.mjs        single-entry CLI (fcpxml / fcp / help)
  make-cut.mjs   authors the .fcpxml
  fcp.mjs        drives Final Cut Pro (dispatcher; spreads named wrappers)
lib/
  edit.mjs       cadence / section / title planning
  fcpxml.mjs     FCPXML element builders
  fcp-ax.mjs     fixed-purpose AX helpers (clickMenu, setTextField, ...)
  fcp-ax-generic.mjs  universal AX primitives (getAttr/setAttr/perform/...)
  fcp-wrappers.mjs    197 menu-bar named wrappers
  fcp/
    inspector.mjs     Inspector setters + complete-Share dialog flow (27)
    apply.mjs         catalog apply (title/transition/generator) + state (8)
    menus-extra.mjs   submenu wrappers (56)
  render/
    grades.mjs   FCP colour-grade look library
    template.mjs reference-fcpxml cadence/grade parser
    ffmpeg.mjs   ffprobe measurement helpers (loudness/aspect/fps for FCPXML)
  analyze/       beats / motion / score / faces — edit-decision intelligence
  source/sources.mjs   clip discovery + duration probe
references/
  fcp-menus.txt  live-enumerated catalog of all 574 menu paths
```
