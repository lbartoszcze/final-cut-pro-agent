# References

This directory vendors nineteen FCPXML files that exercise the schema far more deeply than `lib/fcpxml.mjs` currently does. They exist because the first commit of this repo was written without examining a single sophisticated Final Cut Pro export — its schema vocabulary turned out to be a tiny subset of what FCP actually emits.

## On "Super Bowl ad level"

Actual Super Bowl spot source projects are not publicly available. They are agency intellectual property (Wieden+Kennedy, Droga5, Goodby Silverstein), they contain licensed footage and music and talent imagery whose redistribution would breach contracts, and the majority of that tier is cut in Avid Media Composer or DaVinci Resolve rather than Final Cut Pro. There is no honest way to download "the FCPXML for the latest Doritos commercial" — it does not exist as a downloadable artifact.

The closest legitimate proxies are what is here. The `premiumbeat/` set in particular comes from Shutterstock + PremiumBeat's editor kits — distributed free for commercial use, each one teaching a technique used in the kind of work the user asked for: Hollywood color grading, blockbuster 3D action titles, slow-motion / speed-effect time-remapping, blend-mode compositing, muzzle flashes for action sequences. Schema-sophistication and technique-sophistication, not literal Super Bowl spots.

## What's vendored

### `swift-fcpxml/` — real FCP exports (MIT, [orchetect/swift-fcpxml](https://github.com/orchetect/swift-fcpxml))

| File | What it demonstrates |
|---|---|
| `Complex.fcpxml` | Broadest schema coverage. `adjust-colorConform`, `adjust-volume`, `audio-channel-source`, `fadeIn`, `smart-collection` with `match-clip`/`match-media`/`match-ratings` filters, `chapter-marker`, generic `marker`, project metadata via `md`. |
| `MulticamMarkers.fcpxml` | The only file that exercises FCP's multicam schema: `multicam` resource holding one `mc-angle` per camera, timeline-level `mc-clip` with `mc-source` selectors for active video and audio angle. |
| `CompoundClips.fcpxml` | Compound-clip mechanism. `media` element typed as compound clip in resources, inner `sequence` + `spine` defining the compound, timeline-level `ref-clip` referencing it by id. |
| `SyncClip.fcpxml` | Synchronized clip schema. `sync-clip` + `sync-source` for documentary / interview workflows where camera and external audio are bundled into one timeline element. |

### `cutlass/` — procedural test fixtures (MIT, [andrewarrow/cutlass](https://github.com/andrewarrow/cutlass))

| File | What it demonstrates |
|---|---|
| `test_cinematic_production.fcpxml` | Polished short-form structure: main footage + B-roll + soundtrack + production logo, multi-format resources (project rate, source rate, logo aspect), full library + event + project + sequence wrapper. |
| `test_color_correction.fcpxml` | `filter-video` wrapping a color-effect uid inside an `asset-clip`, parameter-driven adjustment via `param`. The static form of a color grade. |
| `test_keyframe_animation.fcpxml` | `param` element with nested `keyframeAnimation` holding `keyframe` children, each carrying `time` + `value`. Authoritative example for animated parameters. |
| `test_complex_compositing.fcpxml` | Multi-lane stacking: `lane` attribute on `asset-clip` and `title` for picture-in-picture, lower-thirds-over-clip, split-screen. `adjust-transform` children specifying anchor / position / scale / rotation. |

### `pipeline-neo/` — production test fixtures (MIT, [TheAcharya/pipeline-neo](https://github.com/TheAcharya/pipeline-neo))

The most schema-diverse references in the collection. pipeline-neo is the modern Swift 6 successor to reuelk/pipeline.

| File | What it demonstrates | Stats |
|---|---|---|
| `TimelineSample.fcpxml` | Biggest schema-coverage fixture. `adjust-stabilization`, `adjust-transform`, `pan-rect`, `timeMap` + `timept` retiming, `fadeOut` audio fade, `filter-audio` + `filter-video`, plus 134 `adjust-colorConform` calls. | 265 KB / 278 `md` / 190 `param` |
| `TimelineWithSecondaryStorylineWithAudioKeyframes.fcpxml` | Connected secondary storylines (b-roll above primary spine), `keyframeAnimation` on audio volume params, `adjust-noiseReduction`. Music-video edits use this constantly. | 131 KB / 44 `keyword` / 44 `asset-clip` |
| `CaptionSample.fcpxml` | The ONLY reference with `<caption>` schema — 45 captions with full `text-style-def` per caption. Required for any subtitle / closed-caption work. | 36 KB / 45 `caption` |
| `CutSample.fcpxml` | Cuts-heavy timeline with `adjust-stabilization` on multiple clips, inline `<data>` audio blobs, `clip` wrapper element vs `asset-clip`. | 74 KB |

### `splicekit/` — biggest real-world export (MIT, [elliotttate/SpliceKit](https://github.com/elliotttate/SpliceKit))

| File | What it demonstrates | Stats |
|---|---|---|
| `Test_Library_Info.fcpxml` | Largest reference at 1.8 MB. Originally an OpenTimelineIO interop test library. Surfaces `adjust-conform`, `adjust-humReduction`, `adjust-loudness`, `analysis-marker`, `collection-folder`, `keyword-collection`, `match-analysis-type`, `match-shot`, `rating`, `shot-type`. Authoritative reference for audio cleanup + library organization. | 1.8 MB |

### `premiumbeat/` — extracted from Shutterstock + PremiumBeat editor kits

Source: the five Final Cut Pro X Editor Kits at [premiumbeat.com/fcpx](https://www.premiumbeat.com/fcpx), distributed by PremiumBeat (a Shutterstock company) free for commercial use. Each kit ships as a macOS `.dmg` containing an Electron installer + footage + music. The Electron app builds an FCPXML at runtime from a JSON template embedded in `app.js`. These references are extractions of those JSON templates rendered to clean FCPXML, with all asset `src` paths replaced by `file:///premiumbeat-kit/<name>.mp4` placeholders so no proprietary footage is redistributed. The schema and structure are PremiumBeat's; the bundled video and music are not in this repo.

| File | What it demonstrates | Stats |
|---|---|---|
| `box-office-impact.fcpxml` | "Box Office Impact" — Hollywood-trailer 3D action titles. Heaviest keyframe-animation reference in the repo. | 115KB / 1590 lines / 1117 `param` / 12 `keyframe` |
| `ready-aim-edit.fcpxml` | "Ready, Aim, Edit" — muzzle flashes for action footage via small-asset compositing. Many-asset / many-bookmark reference. | 46KB / 22 `asset` / 22 `bookmark` / 30 `param` |
| `blockbuster-color.fcpxml` | "Blockbuster Color" — Hollywood color-grade workflow on the Color Board. Filter-driven grading reference. | 30KB / 37 `param` / 13 `filter-video` |
| `mix-master.fcpxml` | "Mix Master" — blend-mode compositing (Multiply, Screen, Overlay, etc.). Only reference with `adjust-blend` (13×) and 11× `conform-rate`. | 27KB / 13 `adjust-blend` / 11 `conform-rate` |
| `extreme-action.fcpxml` | "Extreme Action" — speed effects via optical-flow time remapping. Only reference with `<timept>` time-point keyframes for retiming. | 13KB / 8 `timept` |

## How these are used

`SCHEMA-NOTES.md` in this directory catalogs the elements real exports use that the current `lib/fcpxml.mjs` doesn't, with one row per element naming which reference file demonstrates it. That diff is the implementation roadmap for bringing the emitter up to a real-export level of fidelity.

The vendored bookmark blobs inside the FCPXML resources point at filesystem paths on the original authors' machines (`/Users/aa/...`, `file:///Volumes/VideoMedia/...`). They are useful as schema reference but cannot be opened as live projects on this machine — that would require the original media plus a bookmark refresh.

## Provenance and license

`swift-fcpxml/` and `cutlass/` each carry the upstream `LICENSE` file verbatim. Both source repositories are MIT-licensed, which permits redistribution provided the copyright notice is preserved. Files in those subdirectories are unmodified from upstream.

`premiumbeat/` files are derived works: the FCPXML JSON templates were extracted from the `app.js` files inside PremiumBeat's freely-distributed editor-kit DMGs (downloadable from `https://fcpx-packages.premiumbeat.com/fcp-x-<kit>-kit.dmg` for kits `mix-master`, `box-office-impact`, `extreme-action`, `ready-aim-edit`, `blockbuster-color`). All asset `src` paths were stripped and replaced with placeholder strings so the extracted FCPXMLs are schema reference only — not direct redistributions of the kits' bundled footage or music. To use these as actual edit projects, download the original DMGs from PremiumBeat. The kits themselves are advertised by PremiumBeat as "free for commercial use" with included Shutterstock footage and PremiumBeat music.
