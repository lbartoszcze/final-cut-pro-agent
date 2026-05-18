# YouTube transcripts — Final Cut Pro reference videos

Captured 2026-05-17 via `yt-dlp --skip-download --write-auto-sub --sub-lang en --sub-format vtt`.

Each video is persisted in two formats:
- `*.en.vtt` — full WEBVTT with timestamps + inline cue styling
- `*.txt` — deduplicated plain text (timing/HTML stripped) for grep/reference

## Source URLs (`urls.txt`)

8 inputs:
- 4 single-video URLs in `single/`
- 2 playlist URLs in the named playlist subfolders (`Final Cut Pro X Editing Tutorials/`, `Learn Final Cut Pro/`)
- 2 of the single-video URLs (`MotoguQBDHY`, `OZFtRYnUuoQ`) happen to be members of those playlists and were captured under the playlist subfolders

## Contents — 26 transcripts

### `Final Cut Pro X Editing Tutorials/` (11 videos, Justin Brown / Primal Video)

```
001  8BfyROcym2I   Final Cut Pro X Tutorial: How to Start for Beginners
002  zN4VSalPtlM   Final Cut Pro Tutorial: How to Edit Videos for Beginners
003  pWRVEuK6Vus   Final Cut Pro X Tutorial: 5 Ways to SAVE TIME Editing Video
004  L88wGpZbrms   10 Best Effects YouTubers Use in FCPX (NO PLUGINS)
005  JtT3aNHlc_Q   How to Edit Audio in Final Cut Pro X (Complete Beginner's Guide)
006  Qufkxmwn31M   How to Export in Final Cut Pro X (Best Settings for YouTube)
007  8i80yCQ8_8o   15 Keyboard Shortcuts GUARANTEED To Save You Time
008  HHRbILfOQFo   How to Color Grade in Final Cut Pro X for Beginners
009  MotoguQBDHY   Final Cut Pro Tutorial: Complete Beginners Guide to Editing
010  6rh7BqRY_6o   How I Edit My YouTube Videos (effects, plug-ins, tips)
011  QrIpLS9rPEY   How to Remove Background Noise in FCP (Hiss, Static, White Noise)
```

### `Learn Final Cut Pro/` (11 videos)

```
001  syfRvfGAscE   Getting Started with Final Cut Pro: Beginners Tutorial
002  JJnGqBGKV54   10 Essential Tips for Final Cut Pro
003  k9s4hwjcJwk   How to Color Grade in Final Cut Pro
004  gEtqyfTx_jU   Final Cut Pro vs Adobe Premiere: Best Video Editor
005  ymrzLGA6UcU   Next Level Final Cut Pro Tips
006  0Ch7L5hHAkM   Vertical Videos in FINAL CUT PRO: Reels, TikTok & Shorts
007  OClUcCfXZt0   Epic Final Cut Pro Plugins I Use ALL the Time
008  eKG_T9GumVM   Final Cut Pro for iPad: Guide & Review
009  OZFtRYnUuoQ   How to color grade LOG in Final Cut Pro
010  Re6vRP6jMEM   How to edit Reels & TikToks with Final Cut Pro
011  AFcALHgwX_M   Final Cut Pro: The 9 Things Everyone Gets Wrong
```

### `mkbhd-method/` (1 video — The Studio breakdown of MKBHD's editing workflow)

```
eNgD1kg3U14   The MKBHD Method™ For Editing High Quality Videos (The Studio, 43 min, 1.3M views)
```

Mined for the `mkbhd-review` style pack updates: music run cap 30s,
dialogue peak -12dB / avg -20dB, dialogue HPF 80Hz, graphic ease ratios
50/20 out/in, film-stock target 70mm, music genre hint
uptempo-jazz-bebop, silence-fill ambience threshold 0.5s.

### `yc-launch/` (7 videos — YC launch / "how to launch your startup" canon)

```
fetC2EpDtN8   Launch quickly, and iterate.
3xU050kMbHM   Kat Mañalac - How to Launch (Again and Again)
u36A-YTxiOw   The Best Way To Launch Your Startup | Startup School
Nsx5RDVKZSk   Why Startup Founders Should Launch Companies Sooner Than They Think
PpNHP3-KXoE   Change the way you think about launching.
Rzlr2tNSl0U   DoorDash's Application Video for YC S13
f0tPjcgcwnQ   When to Launch Your Startup and When to Wait
```

These ground the `--style=yc-launch` pack in lib/styles/packs.json with
actual YC-canon source material rather than archetype guess.

### `single/` (4 videos)

```
xVuz1OJ7YyU   Final Cut Pro X Advanced Editing Tutorial
j_lIFBRscKw   Color Grading in Final Cut Pro (Beginner to Advanced)
jJhGzfuirto   How to Add Subtitles in Final Cut Pro (Automatically!)
25o0ulQBq_c   How to Animate Anything in Final Cut Pro
```

## Reproducing

```bash
yt-dlp --skip-download --write-auto-sub --write-sub --sub-lang en \
       --sub-format vtt --output "%(playlist_title|single)s/%(playlist_index|)03d-%(id)s-%(title).80B.%(ext)s" \
       -a urls.txt
```

Then run the in-repo VTT→TXT converter (see git history for the one-liner) to
regenerate the plain-text companions.
