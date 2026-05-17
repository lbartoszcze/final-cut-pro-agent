# Roadmap — Final Cut Pro scope

This project authors a **Final Cut Pro project** and drives Final Cut Pro.
Final Cut Pro is the only renderer. The previous ffmpeg "direct render" path
(`cut render`, `lib/render/video.mjs`, the `cli/` pipeline, vidstab
preprocess, whisper caption burn-in) was **removed** — anything that produced
video without Final Cut Pro is gone by design.

Status legend: **✅ in the FCPXML** · **🟡 partial** · **▶ FCP-render-side** · **❌ not yet**

## Editorial decisions (baked into the FCPXML)

| Concern | Status |
|---|---|
| Beat-grid / section cadence (`--bpm`/`--bars`/`--style`) | ✅ |
| Auto BPM + downbeat from `--music` | ✅ `lib/analyze/beats.mjs` |
| Section-aware shot selection (`--smart-pick`) | ✅ `lib/analyze/score.mjs` |
| Visual-continuity match cuts (`--match-cuts`) | ✅ |
| Motion / scene scoring per shot | ✅ `lib/analyze/motion.mjs` |
| Face-aware hook/chorus + reaction B-roll (`--faces`) | ✅ `lib/analyze/faces.mjs` |
| B-roll cutaways on `lane="1"` (`--brolls`) | ✅ |
| Hook window (`--hook-sec`) | ✅ |
| Multicam angle alternation (`camA_*`/`camB_*`) | ✅ |
| Audio-onset cut snap | ✅ `detectAudioOnsets` |
| Template cadence + grade borrow (`--template`) | ✅ `lib/render/template.mjs` |

## Look / colour (FCP-native effects in the FCPXML)

| Concern | Status |
|---|---|
| Per-clip grade — `FFColorCorrectionEffect` (`--look`) | ✅ `lib/render/grades.mjs` |
| Auto-look from ffprobe signalstats | ✅ (analysis only; grade is FCP-native) |
| Custom LUT — `FFCustomLUT` (`--lut`) | ✅ |
| Shot-matching / per-section nudge | 🟡 grade is per-look; per-shot match removed with renderer |

## Format / delivery

| Concern | Status |
|---|---|
| Aspect → FCPXML `<format>` (`--aspect`) | ✅ |
| Frame rate → `frameDuration` (`--fps`) | ✅ |
| Length cap (`--max-duration`) | ✅ |
| Platform presets (`--platform`) | ✅ |
| Per-clip `<adjust-volume>` level match (`--audio-target`) | ✅ |
| `dialogue` / `video` audio roles | ✅ |
| Codec / bitrate / colour-space / HDR | ▶ chosen in FCP's Share/Export, not by this tool |
| Final render | ▶ Final Cut Pro only |

## Markers / structure

| Concern | Status |
|---|---|
| Auto chapter-markers at section boundaries | ✅ |
| Custom markers (`--custom-markers`) | ✅ |
| Cross-dissolve transitions at section boundaries | ✅ |
| Compound clips / sync clips helpers | ✅ `lib/fcpxml.mjs` |
| Keyword tagging per cut | ✅ |

## Driving Final Cut Pro

| Concern | Status |
|---|---|
| Open project/fcpxml in FCP (`cut fcp open`) | ✅ `open -a` |
| Background effect / colour-preset / Share driver | 🟡 needs an input env that permits GUI automation |

## Removed (non-FCP "other way")

`lib/render/video.mjs`, `lib/render/build.mjs`, `lib/source/preprocess.mjs`,
`lib/cli/{overlays,post,render_args}.mjs`, `lib/analyze/captions.mjs`, the
ffmpeg-render functions in `lib/render/ffmpeg.mjs`, the ffmpeg-filter exports
in `lib/render/grades.mjs`, and the `cut render` subcommand + `render` npm
script — all deleted. ffmpeg/ffprobe remain only as measurement tools that
inform the FCPXML; they never render the output.
