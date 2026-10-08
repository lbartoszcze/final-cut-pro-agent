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

- **Every menu command** — every menu-bar-reachable FCP capability is
  dispatchable via `cut fcp menu click <Top> [Sub...] <Leaf>` (2-, 3-, and
  4-level paths verified live). A catalog is kept at
  `references/fcp-menus.txt`; `cut fcp menu list` reproduces it live from
  the running FCP.
- **Every accessibility element** — `cut fcp ax get|set|press|select`
  reach any AXDescription-addressable element (Inspector sliders, popups,
  rows); `cut fcp ax find <substring>` and `cut fcp ax dump` name them.
- **Catalog browsers** — `cut fcp browser apply <name> --panel "<menu path>"`
  opens the browser the menu path names, searches it and applies the row.
- **Modal sheets** — `cut fcp dialog press <label>` and
  `cut fcp dialog set <field> <value>` complete Share, Save As and prompts.

### Functionality → automation mapping

Every FCP capability is reachable through this driver. Mouse-drag gestures
are UI affordances for underlying operations; the operations are automatable
even though the drag affordance is not.

| FCP capability                        | Automated via                                                |
|---------------------------------------|--------------------------------------------------------------|
| Trim clip edges (drag handles)        | `menu click Trim "Trim Start"` / `"Trim End"` / `"Trim to Selection"` |
| Slice clip (blade tool drag)          | `menu click Trim Blade` / `"Blade All"`                      |
| Move clip in timeline (drag)          | `menu click Edit Cut`, position the playhead, `menu click Edit Paste` / `Insert` / `Overwrite` |
| Connect clip to lane (drag)           | `menu click Edit "Connect to Primary Storyline"`, `"Lift from Storyline"` |
| Set keyframe (drag in animation editor) | `menu click Modify "Add Keyframe"` + `ax set AXValue <parameter> <value>` at the playhead |
| Color Wheels / Color Board (drag)     | `ax find` the control's description, then `ax set AXValue <description> <value>` |
| Audio level (drag fader)              | `menu click Modify "Adjust Volume" Up` / `Down`, or `ax set AXValue Volume <dB>` |
| Opacity / transform / crop (drag handles) | `ax set AXValue <Opacity, Position X, Rotation, ...> <value>` |
| Mask (paint brush)                    | `menu click Modify "Add Magnetic Mask"` (FCP auto-mask)      |
| Pick effect / title / transition      | `browser apply <name> --panel "<the browser's menu path>"`   |
| Multi-step Share / Export             | `menu click File Share <preset>`, `dialog set Title <name>`, `dialog press Next…`, `dialog press Save` |
| Any other parameter                   | `ax find <substr>` to discover its AXDescription, then `ax set` |

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
cut fcp app open cut.fcpxml

# 3. Drive FCP from the CLI: a few primitives reach every menu path and element
cut fcp menu list                                   # every menu-bar-reachable path
cut fcp menu click Modify "Adjust Volume" Up        # any menu path
cut fcp browser apply Vignette --panel "Window > Show in Workspace > Effects"
cut fcp ax set AXValue Opacity 50                   # any Inspector control by description
cut fcp ax find Opacity                             # discover the description first

# 4. Complete the multi-step Share dialog without a mouse
cut fcp menu click File Share "Export File (default)…"
cut fcp dialog set Title MyCut
cut fcp dialog press Next…
cut fcp dialog press Save
```

`cut fcp help` lists every object (`app`, `menu`, `browser`, `ax`, `dialog`)
and its verbs. There is no command per menu item, Inspector slider or
recipe: `menu list` names every path `menu click` reaches, `ax find` and
`ax dump` name every element `ax get|set|press|select` reaches, and a
multi-step job is those primitives in order. An unknown object or verb exits
2 naming the command; a primitive whose element is missing exits 1 with the
label it looked for.

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
  fcp.mjs        drives Final Cut Pro: app / menu / browser / ax / dialog primitives
lib/
  edit.mjs       cadence / section / title planning
  fcpxml.mjs     FCPXML element builders
  fcp-ax.mjs     fixed-purpose AX helpers (clickMenu, setTextField, ...)
  fcp-ax-generic.mjs  universal AX primitives (getAttr/setAttr/perform/...)
  render/
    grades.mjs   FCP colour-grade look library
    template.mjs reference-fcpxml cadence/grade parser
    ffmpeg.mjs   ffprobe measurement helpers (loudness/aspect/fps for FCPXML)
  analyze/       beats / motion / score / faces — edit-decision intelligence
  source/sources.mjs   clip discovery + duration probe
references/
  fcp-menus.txt  live-enumerated catalog of all 574 menu paths
```
