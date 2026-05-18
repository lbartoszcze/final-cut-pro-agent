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

- **574 menu commands** — every menu-bar-reachable FCP capability is
  dispatchable via `cut fcp menu <Top> [Sub...] <Leaf>` (2-, 3-, and 4-level
  paths verified live). Catalog persisted at `references/fcp-menus.txt`;
  reproduce live with `cut fcp menus`.
- **346 named wrappers** for the highest-frequency operations — grouped help
  via `cut fcp wrappers`. Breakdown:
  - 197 menu wrappers (Edit / Trim / Modify / Clip / Mark / View / File / Share / Window / App)
  - 56 submenu wrappers (Keyframes / Track / Source Media / Apply Name / Roles / Audition / Browser / Viewer / Index / Sort)
  - 48 Inspector / Color / Audio / Crop setters + complete-Share flow
  - 25 transcript-derived technique wrappers (conform / LUT / voice-isolate / captions / ...)
  - 12 multi-step workflow recipes (noise-reduce / log-grade-stack / ken-burns / ...)
  - 8 catalog-apply + status readers
- **6 universal AX primitives** reach any AXDescription-addressable element:
  `ax-get`, `ax-set`, `ax-press`, `select`, `dialog-button`, `dialog-set`.

### Functionality → automation mapping

Every FCP capability is reachable through this driver. Mouse-drag gestures
are UI affordances for underlying operations; the operations are automatable
even though the drag affordance is not.

| FCP capability                        | Automated via                                                |
|---------------------------------------|--------------------------------------------------------------|
| Trim clip edges (drag handles)        | `trim-start`, `trim-end`, `trim-to-selection`, `nudge-left/right` |
| Slice clip (blade tool drag)          | `blade`, `blade-all`                                         |
| Move clip in timeline (drag)          | `cut` + position playhead + `paste` / `insert` / `overwrite` |
| Connect clip to lane (drag)           | `connect`, `lift`, `collapse`, `overwrite`                   |
| Set keyframe (drag in animation editor) | `add-keyframe` + Inspector setter at the playhead position |
| Color Wheels (drag wheel puck)        | `set-master-sat/bri`, `set-shadows-*`, `set-mids-*`, `set-highs-*` |
| Color Board sliders (drag)            | `set-saturation`, `set-exposure`, `set-contrast`, `set-highlights`, `set-shadows`, `set-midtones` |
| Audio level (drag fader)              | `volume-up/down/absolute/relative`, `set-volume`, `set-pan`  |
| Opacity / transform (drag handles)    | `set-opacity`, `set-position-x/y`, `set-rotation`, `set-scale-*`, `set-anchor-x/y` |
| Crop (drag corners)                   | `set-crop-left/right/top/bottom`                             |
| Mask (paint brush)                    | `Modify > Add Magnetic Mask` via menu (FCP auto-mask)        |
| Pick effect / title / transition      | `apply-effect`, `apply-title`, `apply-transition`            |
| Multi-step Share / Export             | `export <preset> <filename>` (Open Share → fill → Next → Save) |
| Any other Inspector parameter         | `inspect-find <substr>` to discover AXDescription, then `inspect-set` |

The only FCP input genuinely outside macOS Accessibility scope is
freehand pixel painting with the brush tool — and FCP's built-in shape /
color / magnetic mask systems cover the same functional need via menu paths.

## Workflow

```bash
# 1. Author the Final Cut Pro project (cut decisions baked in)
cut fcpxml --clips=./footage --music=track.mp3 --bars=24 --style=cinematic \
           --look=cinematic --aspect=2.35:1 --fps=24 --out=cut.fcpxml

# 1a. Genre archetype packs (merge UNDER any explicit flag you also pass)
cut fcpxml --style=yc-launch --clips=./footage --out=launch.fcpxml
cut fcpxml --list-styles            # 8 packs: yc-launch, mkbhd-review, ...

# 1b. Burn subtitles from an SRT/VTT (Whisper / yt-dlp output)
cut fcpxml --clips=./footage --captions=subs.vtt --caption-lang=en --out=cut.fcpxml

# 1c. Drop brainrot SFX + a Giphy B-roll into the timeline
cut sfx list                        # 15 cataloged SFX
cut giphy search "celebrate"        # no API key needed (scrape path)
cut fcpxml --clips=./footage --sfx=vine-boom,airhorn --gif="mind blown" \
           --out=cut.fcpxml         # SFX -> audio lane -2, GIF -> B-roll lane 2

# 2. Open it in Final Cut Pro (background, doesn't steal focus)
cut fcp open cut.fcpxml

# 3. Drive FCP from the CLI (any of the 346 named wrappers + 574 menu paths)
cut fcp volume-up                 # Modify > Adjust Volume > Up (+1 dB)
cut fcp apply-effect "Vignette"   # search + apply from Effects browser
cut fcp set-opacity 50            # Inspector Compositing > Opacity
cut fcp add-marker                # Mark > Markers > Add Marker
cut fcp menu File "Share" "Export File (default)…"   # any menu path

# 4. Complete the multi-step Share dialog without a mouse
cut fcp export "Export File (default)…" "MyCut"
```

`cut fcp help` shows the base commands; `cut fcp wrappers` lists all
346 named operations grouped by section; `cut fcp menus` enumerates every
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
