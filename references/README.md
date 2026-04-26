# References

This directory vendors ten real-world and procedurally-generated FCPXML files that exercise the schema far more deeply than `lib/fcpxml.mjs` currently does. They exist because the first commit of this repo was written without examining a single sophisticated Final Cut Pro export — its schema vocabulary turned out to be a tiny subset of what FCP actually emits.

## On "Super Bowl ad level"

Real Super Bowl spot source projects are not publicly available. They are agency intellectual property (Wieden+Kennedy, Droga5, Goodby Silverstein), they contain licensed footage and music and talent imagery whose redistribution would breach contracts, and the majority of that tier is cut in Avid Media Composer or DaVinci Resolve rather than Final Cut Pro. There is no honest way to download "the FCPXML for the latest Doritos commercial" — it does not exist as a downloadable artifact.

The closest legitimate proxy is what is here: a curated set of FCP exports (real and synthetic) that exercise multicam, compound clips, keyframe animation, color conform, smart collections, security-scoped bookmarks, chapter markers, and audio role separation. These are schema-sophistication references, not creative-ambition references.

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

## How these are used

`SCHEMA-NOTES.md` in this directory catalogs the elements real exports use that the current `lib/fcpxml.mjs` doesn't, with one row per element naming which reference file demonstrates it. That diff is the implementation roadmap for bringing the emitter up to a real-export level of fidelity.

The vendored bookmark blobs inside the FCPXML resources point at filesystem paths on the original authors' machines (`/Users/aa/...`, `file:///Volumes/VideoMedia/...`). They are useful as schema reference but cannot be opened as live projects on this machine — that would require the original media plus a bookmark refresh.

## Provenance and license

Each subdirectory contains the upstream `LICENSE` file verbatim. Both source repositories are MIT-licensed, which permits redistribution provided the copyright notice is preserved. No file has been modified after copying.
