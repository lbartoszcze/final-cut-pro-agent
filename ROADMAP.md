# Auto-editor concerns

Every dimension a complete auto-editor needs to handle, with the status of each in this repo. Used as the implementation roadmap.

Status legend: **✅ done** · **🟡 partial** · **❌ missing**

## 1 · Cut decisions

The "when do we switch clips, which clip plays" dimension. Without this nothing else matters.

| Concern | What it is | Status |
|---|---|---|
| Cadence / rhythm | Cuts on a beat grid (BPM × bars × style) | ✅ `lib/edit.mjs` `planBarCuts()` |
| Clip selection | Round-robin or scored pick across the source folder | 🟡 round-robin only — no per-clip scoring |
| Beat detection | Detect beats from a music track instead of fixed BPM | ❌ user must supply BPM manually |
| Scene-change detection | ffmpeg `select='gt(scene,0.4)'` or PySceneDetect to break long takes | ❌ |
| Motion / energy scoring | Score clips by motion-vector magnitude → place in chorus vs verse | ❌ |
| Face / object detection | Cut on people-detection events; favor face-bearing shots | ❌ |
| Audio-energy cuts | Cut on volume peaks / transients in the source audio | ❌ |
| Match cuts | Visual continuity between adjacent clips (motion / colour / position) | ❌ |
| J-cuts / L-cuts | Audio leads or lags picture across the cut | ❌ |
| Multicam coverage | Pick active angle per beat from a multicam clip | ❌ schema reference at `references/swift-fcpxml/MulticamMarkers.fcpxml` |
| Template cadence | Borrow cut timing from an existing edit | ✅ `--template=<path>` in `make-cut.mjs` + `lib/render/video.mjs` |

## 2 · Color

| Concern | What it is | Status |
|---|---|---|
| Default look | Cinematic teal-orange grade applied to every cut | ✅ `--look=cinematic` (default) in `lib/render/grades.mjs` |
| Named looks | warm / cool / vintage / bw / punch | ✅ |
| Auto-look | `signalstats` analysis → pick from library based on luma + chroma | ✅ `--look=auto` |
| Per-clip grade | Different grade for each clip based on its own stats | ❌ currently one look across the whole edit |
| Shot-matching | Match all clips to a hero shot's colour | ❌ FCP has `FFColorMatchUserEffect`; not emitted |
| Color space conform | Auto SDR↔HDR, Rec.709↔Rec.2020 conversion | ❌ schema reference: `references/pipeline-neo/TimelineSample.fcpxml` (134× `adjust-colorConform`) |
| Custom LUT | Load a `.cube` LUT and apply | ❌ schema reference: `references/cutlass/test_color_correction.fcpxml` (`FFCustomLUT`) |
| Per-section grade | Verse-cool / chorus-warm by section | ❌ |
| Template grade carry-through | Inherit grade from a `--template` reference | ✅ |

## 3 · Picture adjustments

| Concern | What it is | Status |
|---|---|---|
| Stabilization | Smooth handheld footage | ❌ schema: `<adjust-stabilization>` in `references/pipeline-neo/TimelineSample.fcpxml` |
| Crop / framing | Reframe shots, pan-and-scan | ❌ schema: `<adjust-crop>`, `<pan-rect>` |
| Transform (pos/scale/rot) | Position, scale, rotation, anchor per clip | ❌ schema: `<adjust-transform>` |
| Speed ramps / retiming | Variable playback speed across a clip | ❌ schema: `<timeMap>` + `<timept>` in `references/premiumbeat/extreme-action.fcpxml` |
| Slow-motion / freeze | Constant slow play or held frame | ❌ |
| Frame-rate conform | Source rate ≠ project rate | ❌ schema: `<conform-rate>` |
| Lens correction | Distortion / vignetting compensation | ❌ |
| Sharpening / unsharp | Edge enhancement | ❌ |
| Noise reduction | Denoise grain or sensor noise | ❌ schema: `<adjust-noiseReduction>` |
| Aspect-ratio reframing | Auto re-crop 16:9 → 9:16 (vertical) and 1:1 (square) | ✅ `--aspect=<w:h[:fit\|fill]>`. Accepts `16:9`, `9:16`, `1:1`, `4:5`, `2.35:1`, `<w>x<h>`. `:fill` center-crops; default `:fit` letterboxes. Both FCPXML format declaration and ffmpeg renderer respect the flag. |
| Vignetting | Soft edge darkening | ❌ |
| Film grain overlay | Synthetic grain texture | ❌ schema: PremiumBeat `Film Grain.moef` |
| Lens flares / light leaks | Stylistic overlays | ❌ |

## 4 · Audio

| Concern | What it is | Status |
|---|---|---|
| Per-clip volume | Match clips to a target level | ✅ `--audio-target=<LUFS>` (default -16). Per-clip `loudnorm` measure → emit `<adjust-volume amount="N dB">` in FCPXML AND apply `loudnorm` filter in ffmpeg renderer. Audio-less clips → silence-padded. |
| Audio fades | Fade in / out at clip edges | ✅ `--audio-fade=<sec>` (default 0.05). `<fadeIn>` / `<fadeOut>` param children in FCPXML + `afade` in ffmpeg. |
| Music ducking under dialogue | Auto-lower music when speech is present | ❌ schema: secondary storyline + `keyframeAnimation` on volume |
| Loudness normalization | Hit a target LUFS (–14 YouTube / –23 broadcast) | ❌ schema: `<adjust-loudness>` |
| Hum reduction | 50/60 Hz mains hum filter | ❌ schema: `<adjust-humReduction>` |
| Audio noise reduction | Remove background hiss | ❌ |
| EQ | Tonal balance per clip / role | ❌ |
| Compression | Even out dynamics | ❌ |
| Sidechain compression | Music ducks against speech key | ❌ |
| Audio crossfades | Smooth seam between music tracks | ❌ |
| Music selection | Pick a music track that fits length + energy | ❌ |
| Sound-effect placement | Stingers, swooshes, impacts at cut points | ❌ schema: `references/premiumbeat/ready-aim-edit.fcpxml` (Bullet Fly By, Door Impact) |
| Voice-over recording | Record narration to a script | ❌ |
| Auto-transcription | Whisper → captions + searchable transcript | ❌ |
| Audio role separation | Split into Dialogue / Music / Effects roles | ❌ schema: `<audio-channel-source>` |
| Surround mix | 5.1 / 7.1 channel layout | ❌ |

## 5 · Transitions

| Concern | What it is | Status |
|---|---|---|
| Cross-dissolve at section boundaries | Soft seam between intro / verse / chorus / outro | 🟡 emitted in cadence-mode FCPXML; not respected in ffmpeg renderer (concat only) |
| Hard cuts | The default — no transition | ✅ |
| Fade in from black / fade out to black | Section opener and closer | ❌ |
| Wipes / push / slide | Stylistic transitions | ❌ |
| Audio crossfade across cut | Smooth audio when picture cuts | ❌ schema: `Audio Crossfade` filter, see `references/pipeline-neo/TimelineSample.fcpxml` |

## 6 · Text & graphics

| Concern | What it is | Status |
|---|---|---|
| Section title cards | "INFINITE", "CHAPTER 2", etc. at section starts | ✅ `lib/edit.mjs` `planTitles()` |
| Lower thirds | Speaker name + role | ❌ schema reference: `Lower Third.moti` |
| Captions / subtitles | Per-clip text with start + duration | ❌ schema: `<caption>` in `references/pipeline-neo/CaptionSample.fcpxml` |
| Auto-captioning from transcript | Whisper → caption track | ❌ |
| Title animation | Keyframed position / scale / opacity on title text | ❌ schema: `references/premiumbeat/box-office-impact.fcpxml` (1117 keyframed params) |
| 3D / animated titles | Motion-template-based title (e.g. trailer titles) | ❌ |
| End cards | Closing graphics with credits / CTA | ❌ |
| Logo overlay / watermark | Persistent corner brand mark | ❌ |
| Speaker labels | Auto-attach speaker name from diarization | ❌ |

## 7 · Composition

| Concern | What it is | Status |
|---|---|---|
| Multi-lane stacking | Anchored clips above the spine (lane > 0) | ❌ schema: `references/cutlass/test_complex_compositing.fcpxml` |
| Picture-in-picture | Inset of one clip over another | ❌ |
| Split screens | Side-by-side / quad-split layouts | ❌ |
| Blend modes | Multiply / screen / overlay / etc. | ❌ schema: `<adjust-blend>` in `references/premiumbeat/mix-master.fcpxml` |
| Chroma key / luma key | Green-screen removal | ❌ |
| Mattes / masks | Shape-based or alpha-based regions | ❌ |
| Compound clips | Reusable mini-edits referenced by id | ❌ schema: `<ref-clip>` in `references/swift-fcpxml/CompoundClips.fcpxml` |
| Synced clips | Camera + external audio bundled | ❌ schema: `<sync-clip>` in `references/swift-fcpxml/SyncClip.fcpxml` |

## 8 · Story / pacing

| Concern | What it is | Status |
|---|---|---|
| Sections (intro / verse / chorus / outro) | Beat-block labelling drives cadence + part activity | ✅ `lib/edit.mjs` `sectionOf()` |
| Hook (opening 3-5s) | Strongest content first | ❌ |
| B-roll insertion | Cutaways layered above primary spine | ❌ |
| Establishing shots | Wide opener for new locations | ❌ |
| Story beats | Key-moment markers user can jump to | ❌ schema: `<chapter-marker>` |
| Reaction shots | Insert reactions at emotional beats | ❌ |
| Pacing variation | Long holds in cinematic, short cuts in chorus | ✅ via cadence per style |

## 9 · Format & delivery

| Concern | What it is | Status |
|---|---|---|
| Aspect ratio | 16:9 / 9:16 / 1:1 / 2.35:1 | ✅ `--aspect=<spec>` with `:fit` (letterbox) or `:fill` (center-crop) modes |
| Frame rate | 23.976 / 24 / 25 / 29.97 / 30 / 50 / 59.94 / 60 | ✅ `--fps=<rate>`. Accepts shorthand (23.976, 24, 25, 29.97, 30, 50, 59.94, 60), explicit `<num>/<den>` rationals, or arbitrary float. FCPXML `frameDuration` and ffmpeg output rate both follow. |
| Resolution | 720p / 1080p / 4K | 🟡 derived from `--aspect`; max dimension still capped at 1920 / 1080 |
| Codec | H.264 / H.265 / ProRes / DNxHR | 🟡 H.264 hardcoded in renderer; FCPXML is codec-agnostic |
| Color space | Rec. 709 / Rec. 2020 / DCI-P3 / sRGB | 🟡 Rec. 709 hardcoded |
| HDR vs SDR | Dolby Vision / HDR10 vs SDR | ❌ |
| Bitrate target | Quality vs file size | ❌ ffmpeg defaults only |
| Vertical re-export | Re-render 16:9 source for 9:16 distribution | ❌ |
| Safe areas | Text inside title-safe / action-safe boxes | ❌ |
| Caption format export | ITT / SRT / WebVTT side-files | ❌ |
| Length cap | Hard limit (TikTok 60s, Reels 90s, YouTube Shorts 60s) | ❌ |
| Loudness target | YouTube –14 LUFS, broadcast –23 | ❌ |

## 10 · Workflow & metadata

| Concern | What it is | Status |
|---|---|---|
| Project / event / library structure | FCPXML wraps in `<library><event><project><sequence>` | ✅ `lib/fcpxml.mjs` `document()` |
| Markers | Generic + chapter | ❌ schema: `<marker>` / `<chapter-marker>` |
| Roles (Dialogue / Music / Effects / Nat) | Audio role tagging for stem export | ❌ |
| Keywords / smart collections | Auto-tag clips for filter-based bins | ❌ schema: `<smart-collection>` + `<match-clip>` family |
| Versions / iterations | V1 / V2 / fine-cut tracking | ❌ |
| Source asset bookmarks | Security-scoped fs bookmarks for media-rep | ❌ FCP must re-locate media on import without these |
| Multicam syncing | Auto-align cameras by timecode or audio waveform | ❌ |

## Counting

- **Total concerns:** 87
- **Done:** 7
- **Partial:** 6
- **Missing:** 74

The current repo handles ~15% of what an auto-editor needs. The biggest leverage gaps are: per-clip volume normalization + ducking (audio is currently zero), aspect-ratio reframing for vertical output, hook-first story beat selection, and beat detection from a music track (replaces the manual `--bpm` flag).
