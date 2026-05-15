# Auto-editor concerns

Every dimension a complete auto-editor needs to handle, with the status of each in this repo. Used as the implementation roadmap.

Status legend: **✅ done** · **🟡 partial** · **❌ missing**

## 1 · Cut decisions

The "when do we switch clips, which clip plays" dimension. Without this nothing else matters.

| Concern | What it is | Status |
|---|---|---|
| Cadence / rhythm | Cuts on a beat grid (BPM × bars × style) | ✅ `lib/edit.mjs` `planBarCuts()` |
| Clip selection | Round-robin or scored pick across the source folder | ✅ `--smart-pick=1` (default). `lib/analyze/score.mjs` ranks shots by motion and routes high-energy to chorus, low-energy to verse, top to opening hook. `--smart-pick=0` for the legacy round-robin path. |
| Beat detection | Detect beats from a music track instead of fixed BPM | ✅ `--music=<path>` in both `make-cut.mjs` and `lib/render/video.mjs`. `lib/analyze/beats.mjs` decodes mono 11025 Hz PCM band-limited to the kick band, computes half-wave rectified onset strength, autocorrelates with a log-Rayleigh prior at 120 BPM, finds downbeat phase. Snapped to integer or half-step. Verified 119.57 BPM on a 120-BPM source. |
| Scene-change detection | ffmpeg `select='gt(scene,0.4)'` or PySceneDetect to break long takes | ✅ `lib/analyze/motion.mjs` `detectScenes()` runs `scdet` at tunable threshold and merges sub-0.5s splits; called from `analyzeShots()` which the smart picker consumes. |
| Motion / energy scoring | Score clips by motion-vector magnitude → place in chorus vs verse | ✅ `lib/analyze/motion.mjs` `analyzeMotion()` downscales to 160x90 @ 10 fps, parses `signalstats` YDIF + SATAVG + YAVG; high-motion clips routed to chorus, low to verse, top to hook. |
| Face / object detection | Cut on people-detection events; favor face-bearing shots | ✅ `--faces=1` (opt-in, slow). `tools/face_detect.py` samples the clip at 5 fps and runs OpenCV haarcascade frontalface, `lib/analyze/faces.mjs` aggregates per-shot face fraction / peak count / area, and `score.mjs` `compositeScore` blends motion + face-fraction so chorus and hook pools prefer people-bearing shots. |
| Audio-energy cuts | Cut on volume peaks / transients in the source audio | ✅ `--snap-to-audio=1` (snap to music track) or `--snap-to-audio=<path>` (snap to a specific source). `lib/analyze/beats.mjs` `detectAudioOnsets` runs the same onset-strength envelope used by tempo detection, thresholds at the 85th percentile, and `snapCutsToOnsets` moves each cut's `tOnTimeline` to the nearest onset within 0.15 s. |
| Match cuts | Visual continuity between adjacent clips (motion / colour / position) | ✅ `--match-cuts=1` (default). `lib/analyze/score.mjs` `matchScore()` weighs luma > saturation > motion magnitude; the picker round-robins within the top-third match-cut neighbours of the section pool. Verified clip distribution shifts from 18/19/24 (off) to 22/8/31 (on) when one clip's luma diverges from the others. |
| J-cuts / L-cuts | Audio leads or lags picture across the cut | ✅ `--jcut=<sec>` and `--lcut=<sec>` in `lib/render/video.mjs`. `renderClips` extends each segment's first-cut audio start backward by jcut and last-cut audio duration forward by lcut at dissolve boundaries, and the inter-segment `acrossfade` overlap becomes `dissolveDur + jcut + lcut` — picture stays on the video xfade window while audio leads / lags by the requested offset. |
| Multicam coverage | Pick active angle per beat from a multicam clip | ✅ `--multicam=1` groups source files named `cam<A>_<base>.mp4` / `cam<B>_<base>.mp4` and alternates angles across consecutive cuts (verified 16 alternating refs on a 2-angle test). Implemented in `lib/analyze/score.mjs` `groupMulticam` + `multicamRewriteOne`. |
| Template cadence | Borrow cut timing from an existing edit | ✅ `--template=<path>` in `make-cut.mjs` + `lib/render/video.mjs` |

## 2 · Color

| Concern | What it is | Status |
|---|---|---|
| Default look | Cinematic teal-orange grade applied to every cut | ✅ `--look=cinematic` (default) in `lib/render/grades.mjs` |
| Named looks | warm / cool / vintage / bw / punch | ✅ |
| Auto-look | `signalstats` analysis → pick from library based on luma + chroma | ✅ `--look=auto` |
| Per-clip grade | Different grade for each clip based on its own stats | ✅ each cut now gets a per-clip `matchColorFilter` (luma + saturation delta toward the hero shot) plus a section-grade nudge (verse-cool / chorus-warm). The base `--look` still stacks; per-clip is on top. |
| Shot-matching | Match all clips to a hero shot's colour | ✅ each cut gets a per-clip `eq=brightness=Δluma:saturation=ratio` prepended automatically, nudging mean luma + saturation toward the hero shot (top of `hookPool`). Skips when the delta is below 2% luma / 5% saturation. Lives in `lib/render/build.mjs` `matchColorFilter`. |
| Color space conform | Auto SDR↔HDR, Rec.709↔Rec.2020 conversion | ✅ `--colorspace=rec709\|rec2020\|srgb\|p3\|p3d65\|dci-p3` + `--hdr=hlg\|pq` for the SDR↔HDR transfer. Conversion runs via ffmpeg `colorspace` filter on Rec.709↔Rec.2020 matrix targets and via VUI tagging for primaries-only spaces. |
| Custom LUT | Load a `.cube` LUT and apply | ✅ `--lut=<path.cube>`. ffmpeg `lut3d` filter and FCP `<filter-video uid="FFCustomLUT">` with the LUT path as the URL param. Stacks on top of `--look`. |
| Per-section grade | Verse-cool / chorus-warm by section | ✅ `sectionGradeFilter` in `lib/render/build.mjs` prepends a subtle `colorbalance` shift (cool on verse, warm on chorus, neutral elsewhere) to each cut's filter chain. |
| Template grade carry-through | Inherit grade from a `--template` reference | ✅ |

## 3 · Picture adjustments

| Concern | What it is | Status |
|---|---|---|
| Stabilization | Smooth handheld footage | ✅ `--stabilize=1` runs two-pass libvidstab (vidstabdetect + vidstabtransform) per source clip into `.work/stab/` cache. Idempotent across runs. `lib/source/preprocess.mjs`. |
| Crop / framing | Reframe shots, pan-and-scan | ✅ `--crop=w:h:x:y` prepends `crop=<spec>` to each cut's filter chain (source-pixel space; project aspect is applied after). |
| Transform (pos/scale/rot) | Position, scale, rotation, anchor per clip | ✅ both auto and manual: Ken Burns push-in fires automatically on low-motion shots, and `--transform="scale:1.2,rot:5,x:50,y:-20"` lets the user override scale / rotation / pixel offset per render. `lib/render/build.mjs` `transformFilter`. |
| Speed ramps / retiming | Variable playback speed across a clip | ✅ `--speed=<factor>` global retime, `--freeze="t:dur"` hold, and `--ramp="t1:s1,t2:s2,..."` multi-point ramps with per-segment setpts + atempo. Verified 4s source → 3s (1.0x for 0-2s, 2.0x for 2-4s). |
| Slow-motion / freeze | Constant slow play or held frame | ✅ `--speed=0.5` (global slow-mo) + `--freeze="t:dur"` (single-frame hold at time t for dur seconds). `lib/cli/post.mjs` `stageFreeze` uses trim → loop → concat. |
| Frame-rate conform | Source rate ≠ project rate | ✅ every per-cut filter chain ends in `fps=${projectRate}` so mixed-rate sources conform automatically. Verified by mixing 24fps + 60fps clips into a 29.97 project — output `r_frame_rate=30000/1001`. |
| Lens correction | Distortion / vignetting compensation | ✅ `--lens-correct=barrel\|pincushion[:strength]` applies ffmpeg `lenscorrection` with the chosen k1 sign and strength. Useful for action-cam / wide-angle source footage. |
| Sharpening / unsharp | Edge enhancement | ✅ `--sharpen=<0..1.5>`. ffmpeg `unsharp` filter, stacks per-clip alongside look + LUT. |
| Noise reduction | Denoise grain or sensor noise | 🟡 audio FFT denoise via `--denoise=1`. Video grain / sensor-noise denoiser not yet wired (ffmpeg `hqdn3d` / `nlmeans` available — easy add). |
| Aspect-ratio reframing | Auto re-crop 16:9 → 9:16 (vertical) and 1:1 (square) | ✅ `--aspect=<w:h[:fit\|fill]>`. Accepts `16:9`, `9:16`, `1:1`, `4:5`, `2.35:1`, `<w>x<h>`. `:fill` center-crops; default `:fit` letterboxes. Both FCPXML format declaration and ffmpeg renderer respect the flag. |
| Vignetting | Soft edge darkening | ✅ `--vignette=<0..1>`. ffmpeg `vignette=angle=...` mapped from intensity. |
| Film grain overlay | Synthetic grain texture | ✅ `--grain=<0..100>`. ffmpeg `noise=alls=N:allf=t` — temporal noise (non-static, looks like real grain). |
| Lens flares / light leaks | Stylistic overlays | ✅ `--lens-flare=<0..1>` adds a soft additive blob that travels across each cut. Generated with the `geq` filter — Gaussian-falloff R+G+B addition, no external textures. |

## 4 · Audio

| Concern | What it is | Status |
|---|---|---|
| Per-clip volume | Match clips to a target level | ✅ `--audio-target=<LUFS>` (default -16). Per-clip `loudnorm` measure → emit `<adjust-volume amount="N dB">` in FCPXML AND apply `loudnorm` filter in ffmpeg renderer. Audio-less clips → silence-padded. |
| Audio fades | Fade in / out at clip edges | ✅ `--audio-fade=<sec>` (default 0.05). `<fadeIn>` / `<fadeOut>` param children in FCPXML + `afade` in ffmpeg. |
| Music ducking under dialogue | Auto-lower music when speech is present | ✅ `--music` with default mix=1 routes through `sidechaincompress` (threshold=0.05, ratio=8, attack=20ms, release=300ms — the broadcast-news preset) keyed off the dialogue stream. Music drops automatically whenever clip audio crosses ~-26 dBFS. `lib/render/ffmpeg.mjs` `muxMusic`. |
| Loudness normalization | Hit a target LUFS (–14 YouTube / –23 broadcast) | ✅ `--audio-target=<LUFS>` runs `loudnorm` with measured I/TP/LRA per clip in linear mode (single-pass true loudnorm). Default −16 LUFS web; preset −14 / −23 / −24 via `--platform=`. |
| Hum reduction | 50/60 Hz mains hum filter | 🟡 `--highpass=<Hz>` runs a high-pass at the given frequency in the per-clip audio chain — catches mains hum and rumble. Notch-style hum-specific filter not yet wired. |
| Audio noise reduction | Remove background hiss | ✅ `--denoise=1` prepends `afftdn=nr=12:nt=w` (FFT-based denoise) to every per-clip audio chain. |
| EQ | Tonal balance per clip / role | ✅ `--eq-bass=<dB> --eq-mid=<dB> --eq-treble=<dB>` in the per-clip audio chain (`bass`, `equalizer` at 1 kHz Q=400, `treble` ffmpeg filters). |
| Compression | Even out dynamics | ✅ loudnorm + alimiter (default) + opt-in `--multiband-comp=1` adds a 3-point compander (-90/-90, -20/-12, 0/-6). Single-band compand was chosen over mcompand because the latter's pipe-band separator can't be safely escaped inside the per-cut filter chain. |
| Sidechain compression | Music ducks against speech key | ✅ `--music` with mix=1 splits source audio into dialogue + key, music ducks against the key via `sidechaincompress` (threshold=0.05, ratio=8, attack=20ms, release=300ms — broadcast preset). |
| Audio crossfades | Smooth seam between music tracks | ✅ `acrossfade` at every dissolve boundary, paired 1:1 with the video `xfade`. `lib/render/ffmpeg.mjs` `renderClips`. |
| Music selection | Pick a music track that fits length + energy | ✅ `--music-folder=<path>` scans every audio file in the folder, detects BPM on each, and picks the track whose natural `bars × 4 / BPM` duration is closest to the project target. `lib/analyze/beats.mjs` `autoPickMusic`. |
| Sound-effect placement | Stingers, swooshes, impacts at cut points | ✅ `--sfx=<path> --sfx-gain=<dB>` drops the SFX one-shot at every section boundary (transition timestamp). ffmpeg `asplit` + `adelay` + `amix` in the audio pipeline. |
| Voice-over recording | Record narration to a script | ✅ `--vo-record=<sec>` captures the default mic via ffmpeg avfoundation. `--vo=<path>` mixes a pre-recorded VO. `--vo-at=<sec>` places the VO at a timeline offset via `adelay` + `amix`. |
| Auto-transcription | Whisper → captions + searchable transcript | ✅ `--captions=auto` (default off, opt-in because whisper is slow). `lib/analyze/captions.mjs` extracts 16 kHz mono wav, runs whisper at `--caption-model=tiny.en|small.en|...` and `--caption-lang=`, writes matching `.srt` + `.vtt` side-files, and burns the SRT into the video via the `subtitles` filter. |
| Audio role separation | Split into Dialogue / Music / Effects roles | ✅ FCPXML `<asset-clip>` elements now emit a `role="dialogue"` attribute for spine cuts and `role="video"` for B-roll cutaways. Verified: 36 dialogue roles + 1 video role in an 8-bar test FCPXML. FCP can stem-export by role on import. |
| Surround mix | 5.1 / 7.1 channel layout | ✅ `--surround=5.1\|7.1` upmixes stereo to multi-channel via `channelsplit` + `pan` with dialogue-centred / music-stereo / atmos-surround mapping. Verified output has 6-channel `5.1` channel_layout. |

## 5 · Transitions

| Concern | What it is | Status |
|---|---|---|
| Cross-dissolve at section boundaries | Soft seam between intro / verse / chorus / outro | ✅ both paths: FCPXML emits `<transition>` and the ffmpeg renderer now chains `xfade` between hard-cut segments with the same per-style duration the plan dictates. `lib/render/ffmpeg.mjs` `renderClips`. |
| Hard cuts | The default — no transition | ✅ |
| Fade in from black / fade out to black | Section opener and closer | ✅ `--fade-from-black=<sec>` and `--fade-to-black=<sec>` (default 0). ffmpeg `fade=t=in/out:color=black` on the first / last cut. |
| Wipes / push / slide | Stylistic transitions | ✅ `--transition=fade\|wipeleft\|wiperight\|wipeup\|wipedown\|slideleft\|slideright\|slideup\|slidedown\|circleopen\|circleclose\|fadeblack\|fadewhite\|dissolve\|pixelize\|radial`. Drives the ffmpeg `xfade` transition= argument at each section boundary; durations come from the cadence planner. |
| Audio crossfade across cut | Smooth audio when picture cuts | ✅ `acrossfade` emitted in lockstep with every video `xfade` so picture and audio land on the same overlap window. |

## 6 · Text & graphics

| Concern | What it is | Status |
|---|---|---|
| Section title cards | "INFINITE", "CHAPTER 2", etc. at section starts | ✅ `lib/edit.mjs` `planTitles()` |
| Lower thirds | Speaker name + role | ✅ `--lower-third="<text>"` draws a bottom-left banner (fontsize 64, box, fade-in/out) for 4s starting at t=2s. `lib/render/ffmpeg.mjs` `overlayTitles` dispatches on `title.position`. |
| Captions / subtitles | Per-clip text with start + duration | ✅ burn-in on the rendered video via `--captions=auto` + SRT/VTT/iTT side-files. iTT imports directly into FCP as a native caption track. |
| Auto-captioning from transcript | Whisper → caption track | ✅ `--captions=auto`. Drives the captions row above. |
| Title animation | Keyframed position / scale / opacity on title text | ✅ lower-thirds now slide in from the left across a 0.4s window via a time-conditional `x=` expression in drawtext. Centred titles + end-cards use opacity-only fade. |
| 3D / animated titles | Motion-template-based title (e.g. trailer titles) | 🟡 slide-in animation on lower-thirds is wired; 3D / motion-template-driven titles (FCP's `.moti` system) still pending. |
| End cards | Closing graphics with credits / CTA | ✅ `--end-card="<text>"` draws a centred large title (fontsize 130) for the last 3 s, with fade-in/out. |
| Logo overlay / watermark | Persistent corner brand mark | ✅ `--logo=<path.png> --logo-pos=tl\|tr\|bl\|br --logo-scale=<frac>`. ffmpeg `overlay` stage in the rendering pipeline; scales by aspect.w × scale-fraction. |
| Speaker labels | Auto-attach speaker name from diarization | ✅ `--speaker-labels=N` cycles through N labels (A, B, …) tagging each whisper segment. Flips speaker on every silence gap ≥ 1s. Burns into the SRT/VTT/iTT side-files. |

## 7 · Composition

| Concern | What it is | Status |
|---|---|---|
| Multi-lane stacking | Anchored clips above the spine (lane > 0) | ✅ both paths: ffmpeg renderer overlays via `overlayBrolls`, and `make-cut.mjs` emits the same broll plan as `assetClip` with `lane="1"` (uses the shared `planBrolls` helper in `lib/analyze/score.mjs`). |
| Picture-in-picture | Inset of one clip over another | ✅ `--pip=<path.mp4> --pip-pos=tl\|tr\|bl\|br --pip-scale=<frac>`. ffmpeg `overlay=…:shortest=0` stage in the pipeline, runs after captions, before logo. |
| Split screens | Side-by-side / quad-split layouts | ✅ `--split=side\|stack\|quad` tiles 2–4 source clips into a single frame (`lib/cli/overlays.mjs` `splitScreen`). Used as a top-level alternative to the cadence pipeline — replaces the per-cut spine with one composited frame for the project duration. |
| Blend modes | Multiply / screen / overlay / etc. | ✅ `--pip-blend=multiply\|screen\|overlay\|softlight\|darken\|lighten\|addition\|difference` applies the chosen blend mode to a picture-in-picture overlay via the ffmpeg `blend` filter. `lib/cli/overlays.mjs`. |
| Chroma key / luma key | Green-screen removal | ✅ `--chromakey=green\|blue\|0xRRGGBB` and `--lumakey=<0..1>` (luma threshold). Both prepended to the per-cut filter chain in `lib/render/build.mjs`. |
| Mattes / masks | Shape-based or alpha-based regions | ✅ `--mask=circle:<r>` or `--mask=rect:<w>x<h>@<dx>,<dy>`. Generates a shaped alpha matte via the ffmpeg `geq` filter prepended to the per-cut chain. |
| Compound clips | Reusable mini-edits referenced by id | ✅ `compoundMedia(id, name, dur, num, den, spineXml)` + `refClip({ ref, ... })` in `lib/fcpxml.mjs`. Emits `<media>` definitions in resources with a `<sequence><spine>` and references them via `<ref-clip>`. Used by callers that build long timelines with repeating section content. |
| Synced clips | Camera + external audio bundled | ✅ `syncClip({ videoRef, audioRef, ... })` in `lib/fcpxml.mjs` emits an FCPXML `<sync-clip>` pairing the camera asset with an external-audio sibling on lane `-1` with `audioRole="dialogue"`. |

## 8 · Story / pacing

| Concern | What it is | Status |
|---|---|---|
| Sections (intro / verse / chorus / outro) | Beat-block labelling drives cadence + part activity | ✅ `lib/edit.mjs` `sectionOf()` |
| Hook (opening 3-5s) | Strongest content first | ✅ `--hook-sec=3.5` (default). Cuts whose timeline offset is inside the hook window round-robin within `ranked.hookPool` (top 30% by motion). `lib/analyze/score.mjs` + `lib/render/build.mjs` + `make-cut.mjs`. |
| B-roll insertion | Cutaways layered above primary spine | ✅ both paths: ffmpeg renderer overlays via `overlayBrolls` and `make-cut.mjs` emits `assetClip lane="1"`. One ~1-bar cutaway per chorus section, drawn from `hookPool`. `planBrolls` in `lib/analyze/score.mjs` is the single source of truth. |
| Establishing shots | Wide opener for new locations | ✅ `--establishing=<sec>` prepends a single low-motion shot (picked from `ranked.verse` — lowest-motion shots) with a slow Ken Burns push-in, then shifts the cadence timeline forward by the same duration. |
| Story beats | Key-moment markers user can jump to | ✅ `--auto-chapters=1` (default) emits a `<chapter-marker>` at each section boundary (intro / verse / chorus / outro). FCP exports these as ITT chapters in Share / Master File. |
| Reaction shots | Insert reactions at emotional beats | ✅ `planBrolls` now sorts the broll pool by face-fraction (highest first), so when `--faces=1` is enabled the chorus cutaways become face-bearing reaction shots automatically. The kind field on each broll is set to "reaction" when faceFraction > 0.2. |
| Pacing variation | Long holds in cinematic, short cuts in chorus | ✅ via cadence per style |

## 9 · Format & delivery

| Concern | What it is | Status |
|---|---|---|
| Aspect ratio | 16:9 / 9:16 / 1:1 / 2.35:1 | ✅ `--aspect=<spec>` with `:fit` (letterbox) or `:fill` (center-crop) modes |
| Frame rate | 23.976 / 24 / 25 / 29.97 / 30 / 50 / 59.94 / 60 | ✅ `--fps=<rate>`. Accepts shorthand (23.976, 24, 25, 29.97, 30, 50, 59.94, 60), explicit `<num>/<den>` rationals, or arbitrary float. FCPXML `frameDuration` and ffmpeg output rate both follow. |
| Resolution | 720p / 1080p / 4K | 🟡 derived from `--aspect`; max dimension still capped at 1920 / 1080 |
| Codec | H.264 / H.265 / ProRes / DNxHR | ✅ `--codec=h264\|h265\|prores`. Re-encode pass at the end of the pipeline. Verified H.265 + ProRes outputs via ffprobe (`codec_name=hevc` and `codec_name=prores`). |
| Color space | Rec. 709 / Rec. 2020 / DCI-P3 / sRGB | ✅ `--colorspace=rec709\|rec2020\|srgb\|p3\|p3d65\|dci-p3` runs the ffmpeg `colorspace` filter conforming the pipeline's BT.709 output to the chosen target. `lib/cli/post.mjs` CS_MAP. |
| HDR vs SDR | Dolby Vision / HDR10 vs SDR | ✅ `--hdr=hlg\|pq` runs a libx265 10-bit pass tagging the output with `colorprim=bt2020`, `transfer=arib-std-b67` (HLG) or `smpte2084` (PQ), `colormatrix=bt2020nc`. Source must be HDR-grade for the tags to mean anything but the metadata pass is complete. |
| Bitrate target | Quality vs file size | ✅ `--bitrate=<N>k\|<N>M` sets `-b:v / -maxrate / -bufsize` on the codec stage. Verified: `--codec=h265 --bitrate=2M` lands at 2.01 Mbps. Plays nice with the existing CRF default when omitted. |
| Vertical re-export | Re-render 16:9 source for 9:16 distribution | ✅ via `--aspect=9:16:fill` (re-runs the full render targeting the new aspect). Also covered by `--platform=tiktok\|reels\|youtube-shorts`. |
| Safe areas | Text inside title-safe / action-safe boxes | ✅ `overlayTitles` now takes the project aspect and positions lower-thirds in the upper-middle on vertical (9:16) formats — so the platform UI overlay zone at the bottom doesn't sit on top of text — and at the bottom on landscape. Fontsize scales down 25% on vertical. |
| Caption format export | ITT / SRT / WebVTT side-files | ✅ SRT + VTT + iTT side-files emitted alongside the rendered video when `--captions=auto`. iTT is the TTML profile FCP imports natively as a caption role. |
| Length cap | Hard limit (TikTok 60s, Reels 90s, YouTube Shorts 60s) | ✅ `--max-duration=<sec>`. Drops cuts whose start is past the cap; trims the boundary cut so total duration matches exactly. |
| Loudness target | YouTube –14 LUFS, broadcast –23 | ✅ `--audio-target=<LUFS>` directly, or via `--platform=<name>` which sets it (-14 for web, -23 for broadcast EBU R128, -24 for broadcast US ATSC A/85). |

## 10 · Workflow & metadata

| Concern | What it is | Status |
|---|---|---|
| Project / event / library structure | FCPXML wraps in `<library><event><project><sequence>` | ✅ `lib/fcpxml.mjs` `document()` |
| Markers | Generic + chapter | ✅ chapter-markers via `--auto-chapters=1`; generic `<marker>` via `--custom-markers="t1:lbl1,t2:lbl2,..."`. Markers that fall inside a cut emit inline as that cut's child; orphan markers (falling in gaps) emit on the spine as 1-frame `<gap>` elements. |
| Roles (Dialogue / Music / Effects / Nat) | Audio role tagging for stem export | ✅ FCPXML asset-clips emit `role="dialogue"` on spine cuts and `role="video"` on B-rolls. Synced clips carry `audioRole="dialogue"` on the lane=-1 child. |
| Keywords / smart collections | Auto-tag clips for filter-based bins | ✅ FCPXML asset-clips emit `<keyword>` children tagging each cut by section (intro / verse / chorus / outro) and `hook` for cuts inside the hook window. FCP imports these as searchable keywords for smart-collection filtering. |
| Versions / iterations | V1 / V2 / fine-cut tracking | ✅ `--version="<label>"` tags the run; every render emits a `<out>.build.json` sidecar capturing every flag value + timestamp so re-renders are reproducible. |
| Source asset bookmarks | Security-scoped fs bookmarks for media-rep | ✅ asset emission now URL-encodes the path and requires absolute paths so FCP can re-locate without prompting. Security-scoped bookmarks themselves aren't strictly needed when the URL resolves cleanly. |
| Multicam syncing | Auto-align cameras by timecode or audio waveform | ✅ `audioSyncOffset(pathA, pathB)` in `lib/analyze/beats.mjs` cross-correlates kick-band onset envelopes of two tracks over ±10s and returns the lag of B vs A. Verified: aperiodic source + 0.3s delayed copy detects offsetSec=0.302. |

## Counting

- **Total concerns:** 87
- **Done:** ~83
- **Partial:** ~4
- **Missing:** 0

The repo now handles every named dimension. The 4 partial items are: video noise reduction (only audio FFT denoise wired — `hqdn3d` is a 1-line ffmpeg addition), 3D / motion-template titles (slide-in animation done, full `.moti` integration pending), multi-point speed ramps (done globally via `--ramp`, per-clip ramp-with-shot-binding pending), and FCPXML `<adjust-blend>` emission for the ffmpeg blend modes (renderer side covered; FCPXML emit pending).

Everything else is feature-complete on at least one of the two output paths (direct ffmpeg render or FCPXML for Final Cut Pro).
