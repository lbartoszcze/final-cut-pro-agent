# Schema Notes

What real FCPXML exports use that `lib/fcpxml.mjs` doesn't. Derived from a comparative grep across the eight vendored reference files in `swift-fcpxml/` and `cutlass/`.

## Real `effect` uid format

The placeholder `uid="..."` strings the current emitter writes are wrong. Real uids follow these patterns and `...` is verbatim — FCP resolves it against its own bundle of localized motion templates at import time:

```
.moef  (effects)     .../Effects.localized/<Category>.localized/<Name>.localized/<Name>.moef
.moti  (titles)      .../Titles.localized/<Category>.localized/<Name>.localized/<Name>.moti
.motn  (generators)  .../Generators.localized/<Category>.localized/<Name>.localized/<Name>.motn
.motn  (transitions) .../Transitions.localized/<Category>.localized/<Name>.localized/<Name>.motn
```

Real examples observed in the references:

- Effect: `.../Effects.localized/Looks.localized/50s TV.localized/50s TV.moef`
- Effect: `.../Effects.localized/Stylize.localized/Aged Paper.localized/Aged Paper.moef`
- Effect: `.../Effects.localized/Color.localized/Black & White.localized/Black & White.moef`
- Title: `.../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti`
- Title: `.../Titles.localized/Basic Text.localized/Text.localized/Text.moti`
- Title: `.../Titles.localized/3D.localized/Basic 3D.localized/Basic 3D.moti`
- Generator: `.../Generators.localized/Backgrounds.localized/Clouds.localized/Clouds.motn`
- Generator: `.../Generators.localized/Solids.localized/Vivid.localized/Vivid.motn`
- Generator: `.../Generators.localized/Textures.localized/Metal.localized/Metal.motn`

The categories map 1:1 to the folders in FCP's Effects / Titles / Generators browser. FCP-localized title `Lower Third` lives under `Titles > Dynamic Titles > Geometric` so its uid is `.../Titles.localized/Dynamic Titles.localized/Geometric.localized/Lower Third.localized/Lower Third.moti`.

## Element gap

`*` = not currently emitted by `lib/fcpxml.mjs`. Sources are which reference file demonstrates the element.

| Element | Sources |
|---|---|
| `*adjust-colorConform` | Complex, Multicam, Sync |
| `*adjust-crop` | CutCine, CutKey |
| `*adjust-transform` | CutCine, CutComp, CutKey |
| `*adjust-volume` | Complex |
| `*audio-channel-source` | Complex, Multicam, Sync |
| `*audio-role-source` | Sync |
| `*bookmark` | every export with real assets |
| `*chapter-marker` | Complex |
| `*conform-rate` | CutComp |
| `*fadeIn` | Complex |
| `*filter-video` | CutColor, CutComp |
| `*keyframe` | CutCine, CutComp, CutKey |
| `*keyframeAnimation` | CutCine, CutComp, CutKey |
| `*keyword` | Sync |
| `*marker` | Complex, Compound, Multicam, Sync |
| `*match-clip` / `*match-media` / `*match-ratings` | Complex, CutCine, CutColor, CutComp, CutKey, Sync |
| `*mc-angle` / `*mc-clip` / `*mc-source` | Multicam |
| `*md` (metadata) | Complex, Compound, CutCine, CutKey, Multicam, Sync |
| `*media` | Compound, Multicam |
| `*metadata` (wrapper) | Complex, Compound, CutCine, CutKey, Multicam, Sync |
| `*multicam` | Multicam |
| `*note` | Sync |
| `*param` | Complex, CutCine, CutColor, CutComp, CutKey |
| `*ref-clip` | Compound |
| `*smart-collection` | Complex, CutCine, CutColor, CutComp, CutKey, Sync |
| `*sync-clip` / `*sync-source` | Sync |
| `*trim-rect` | CutKey |
| `*video` (generator clip) | Complex, Compound, CutCine, CutKey |

What the current emitter does cover: `fcpxml`, `resources`, `format`, `effect`, `asset`, `media-rep`, `library`, `event`, `project`, `sequence`, `spine`, `asset-clip`, `gap`, `transition`, `title`, `text`, `text-style`, `text-style-def`. Eighteen elements, vs. 47 the references collectively use.

## Highest-leverage gaps to close first

1. **`bookmark` inside `media-rep`** — real FCP exports always include a base64 security-scoped fs bookmark. Without it, FCP must re-locate the source media on import, which prompts the user. Generating one requires AppleScript / Foundation `URL.bookmarkData()`; for emitter purposes, omitting it is the current behaviour and means re-locate-on-import.

2. **`adjust-transform` and `adjust-crop`** — clip-level inline adjustments. These are children of `asset-clip`, not separate effect filters. Encoding pan / scale / rotation as `adjust-transform position="0 0" scale="1 1" rotation="0"` is much cheaper than wrapping a Motion template, and is what FCP itself writes for native Position / Scale inspector edits.

3. **`adjust-colorConform`** — auto-applied when source colour space differs from project. Format: `<adjust-colorConform conformType="auto"/>` as a child of `asset-clip`. The user's own Wisent backup project (inspected via SQLite) had `FFIntrinsicColorConformEffect` on every clip — this is its FCPXML representation.

4. **`param` + `keyframe` + `keyframeAnimation`** — animatable parameters. Schema: `<filter-video><param name="..." key="..."><keyframeAnimation><keyframe time="0s" value="0"/><keyframe time="2s" value="1"/></keyframeAnimation></param></filter-video>`. Required for any moving title, motion path, fade, or animated colour effect.

5. **`marker` and `chapter-marker`** — sit as children of `asset-clip` to mark the playhead. `chapter-marker` is what YouTube chapters / podcast chapters export from. Format: `<marker start="..." duration="1s" value="text"/>` and `<chapter-marker start="..." duration="1s" value="text" posterOffset="0s"/>`.

6. **`audio-channel-source`** — when a clip's audio has been split into roles (Dialogue / Music / Effects). Schema: `<audio-channel-source srcCh="1, 2" role="dialogue"/>` as a child of `asset-clip`. Required for any documentary / interview workflow.

## What this changes for the agent

`lib/fcpxml.mjs` should be rewritten to:
- Emit `adjust-colorConform` and `adjust-transform` on every asset-clip by default
- Accept a markers list (chapter + generic) and emit them as children
- Support a "filters" list per clip that emits `filter-video` / `filter-audio` with params and optional keyframe animations
- Support multicam by emitting `multicam` + `mc-angle` resources and `mc-clip` spine elements
- Support compound clips via `media` resource + `ref-clip` spine
- Use real `effect uid` strings sourced from a hard-coded catalog (Effects, Titles, Generators, Transitions) keyed by display name

`lib/fcp-cua-cmds.mjs` should drop fictional effect names ("Cinematic", "Slow Motion", "Vibrant") and target real ones ("50s TV", "Aged Paper", "Black & White", "Colorize", "Background Squares", "Timecode") — verified against `references/` rather than guessed.
