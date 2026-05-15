# final-cut-pro-agent

Auto-editor that takes a folder of source clips and a music track and produces a music-synced, content-aware cut — either rendered straight to MP4/MOV with ffmpeg, or written as `.fcpxml` to open in Final Cut Pro.

What it does on its own:
- detects BPM + downbeat from the music
- analyses every source clip for motion, scene cuts, and (optionally) faces
- picks high-motion shots for the hook and chorus, low-motion for verse and outro
- snaps cuts to onset peaks so it doesn't cut mid-syllable
- shot-matches every clip's colour toward the hero
- adds a subtle Ken Burns push-in on low-motion shots
- emits B-roll cutaways on lane 1 at every chorus
- supports lower-thirds, end-cards, logos, picture-in-picture, chroma/luma keying
- ducks the music under dialogue automatically (sidechain compressor)
- burns in captions (Whisper) + writes SRT / VTT / iTT side-files
- conforms aspect, fps, codec (h264 / h265 / ProRes), audio LUFS, length cap per platform preset

## Install

```bash
git clone https://github.com/lbartoszcze/final-cut-pro-agent.git
cd final-cut-pro-agent
npm install -g .   # puts `cut` on PATH
```

Requires:
- Node 20+
- ffmpeg with libvidstab, libx264, libx265 (`brew install ffmpeg`)
- Optional: whisper (`pip install openai-whisper`) for `--captions=auto`
- Optional: opencv-python in Python 3.12 for `--faces=1`

## Quick start

```bash
cut help                              # full flag reference
cut render --clips=./footage --music=track.mp3 --platform=tiktok --out=out.mp4
cut fcpxml --clips=./footage --music=track.mp3 --bars=24 --style=cinematic --out=cut.fcpxml
```

## Three recipes

### 1. Vertical TikTok / Reels with captions

```bash
cut render \
  --clips=./footage \
  --music=track.mp3 \
  --platform=tiktok \
  --style=jump-cut \
  --brolls=1 \
  --match-cuts=1 \
  --captions=auto \
  --lower-third="@yourhandle" \
  --end-card="follow for more" \
  --out=tiktok.mp4
```

Output is 1080×1920 @ 29.97, ≤60 s, audio at −14 LUFS, with burned-in captions and matching `tiktok.srt` / `tiktok.vtt` / `tiktok.itt` files.

### 2. 16:9 YouTube with cinematic grade

```bash
cut render \
  --clips=./footage \
  --music=track.mp3 \
  --style=cinematic \
  --look=cinematic \
  --bars=32 \
  --establishing=3 \
  --brolls=1 \
  --jcut=0.25 --lcut=0.15 \
  --denoise=1 --limit=1 \
  --logo=./logo.png --logo-pos=br --logo-scale=0.06 \
  --fade-from-black=1 --fade-to-black=2 \
  --aspect=16:9 \
  --captions=auto \
  --out=youtube.mp4
```

### 3. ProRes master for hand-editing in Final Cut Pro

```bash
cut fcpxml \
  --clips=./footage \
  --music=track.mp3 \
  --bars=24 \
  --style=cinematic \
  --brolls=1 \
  --custom-markers="2.5:hook,18.0:turn,28.0:button" \
  --out=cut.fcpxml

cut render \
  --clips=./footage \
  --music=track.mp3 \
  --bars=24 \
  --style=cinematic \
  --codec=prores \
  --out=master.mov
```

`cut.fcpxml` opens directly in FCP with the spine, B-rolls on lane 1, dialogue/video roles, chapter markers, and custom markers. `master.mov` is the ProRes baseline you can drop in to re-grade.

## Flag reference

Run `cut help all` for the full list, or `cut help <topic>` (basic / audio / picture / format / story / titles / composition).

### Content analysis (default-on)

| flag | what it does |
|---|---|
| `--smart-pick=1` | section-aware shot picker (chorus = top motion, verse = bottom, hook = best) |
| `--match-cuts=1` | adjacent-cut continuity score on luma / saturation / motion |
| `--hook-sec=3.5` | length of the opening high-motion window |
| `--brolls=1` | one B-roll cutaway per chorus section on lane 1 |
| `--establishing=<sec>` | prepend a low-motion wide shot opener |
| `--snap-to-audio=1` | snap cut times to onsets in the music (or `<path>` for a specific source) |
| `--faces=1` | OpenCV haarcascade face detection — biases hook + chorus toward people |

### Music

| flag | what it does |
|---|---|
| `--music=<path>` | auto-BPM + downbeat detection, music muxed under dialogue with sidechain ducking |
| `--bpm=<N>` | manual BPM (ignored if `--music` is set) |
| `--bars=<N>` | number of musical bars |
| `--style=<…>` | montage / cinematic / jump-cut / slow-mo cadence presets |

### Audio

| flag | what it does |
|---|---|
| `--audio-target=<LUFS>` | per-clip loudness target (–14 web, –23 broadcast) |
| `--audio-fade=<sec>` | per-clip edge fade |
| `--jcut=<sec>` / `--lcut=<sec>` | audio leads / lags picture at dissolve boundaries |
| `--denoise=1` | FFT denoise per clip |
| `--limit=1` | brick-wall limiter on the output |
| `--highpass=<Hz>` | high-pass filter for mains hum / rumble |
| `--eq-bass / --eq-mid / --eq-treble=<dB>` | 3-band EQ |
| `--sfx=<path>` / `--sfx-gain=<dB>` | SFX one-shot at every section boundary |

### Colour / picture

| flag | what it does |
|---|---|
| `--look=cinematic\|warm\|cool\|vintage\|bw\|punch\|auto` | preset grade |
| `--lut=<.cube>` | custom 3D LUT |
| `--vignette=<0..1>`, `--grain=<0..100>`, `--sharpen=<0..1.5>` | finishing |
| `--stabilize=1` | two-pass libvidstab on each source (cached) |
| `--chromakey=green\|blue\|0xRRGGBB` | green-screen / blue-screen removal |
| `--lumakey=<0..1>` | luma threshold key |

### Composition

| flag | what it does |
|---|---|
| `--pip=<path>` / `--pip-pos=tl\|tr\|bl\|br` / `--pip-scale=<frac>` | picture-in-picture inset |
| `--logo=<path>` / `--logo-pos` / `--logo-scale` | persistent watermark |
| `--lower-third="<text>"` | speaker / role banner |
| `--end-card="<text>"` | closing centred title |

### Captions

| flag | what it does |
|---|---|
| `--captions=auto` | Whisper transcription → burned-in captions + .srt + .vtt + .itt |
| `--caption-model=tiny.en\|small.en\|medium.en` | Whisper model size |
| `--caption-lang=en` | language code |

### Format / delivery

| flag | what it does |
|---|---|
| `--platform=tiktok\|reels\|youtube-shorts\|instagram-feed\|twitter\|youtube\|broadcast\|cinema` | preset bundle |
| `--aspect=16:9\|9:16\|1:1\|4:5\|2.35:1\|<W>x<H>[:fit\|fill]` | aspect + crop mode |
| `--fps=23.976\|24\|25\|29.97\|30\|50\|59.94\|60` | output frame rate |
| `--codec=h264\|h265\|prores` | output codec |
| `--max-duration=<sec>` | hard length cap |
| `--speed=<factor>` | global retime |

### Workflow

| flag | what it does |
|---|---|
| `--auto-chapters=1` | chapter markers at section boundaries |
| `--custom-markers="t1:lbl1,t2:lbl2,…"` | user-defined markers |
| `--template=<path.fcpxml>` | borrow cadence from a reference edit |

## How it works

The pipeline is purely declarative — every flag is a knob on the same plan object. `lib/analyze/` handles content analysis (beats, motion, scenes, faces, audio onsets); `lib/render/build.mjs` turns the analysis into a cut plan; `lib/render/video.mjs` renders it to mp4 through ffmpeg; `bin/make-cut.mjs` emits the same plan as FCPXML.

See `ROADMAP.md` for the per-capability status (currently ~62% coverage of every dimension a complete auto-editor needs).
