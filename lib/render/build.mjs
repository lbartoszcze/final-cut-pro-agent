// Cut planner for the direct ffmpeg renderer. Pure schedule-list math.
// Mirrors logic-pro-agent/lib/render/build.mjs in role: turns style + bars
// + bpm into per-clip cuts + transitions + title overlays. No ffmpeg, no
// fcpxml emission — that lives in synth.mjs / video.mjs.

import { reseed, sectionOf, planBarCuts, transitionFrames, planTitles, pickClipIndex } from "../edit.mjs";
import { pickShotForCut, planBrolls, groupMulticam, applyMulticamAlternation } from "../analyze/score.mjs";
import { snapCutsToOnsets } from "../analyze/beats.mjs";

// Ken Burns push-in: slow zoom-in across the cut. Implemented with the
// `zoompan` filter (designed for time-varying zoom). zoompan operates frame
// indexed (in), so we map our durSec to in*1/fps via a fixed fps assumption
// of 30 — close enough for the visual effect; fitFilter downstream conforms
// the rate. zEnd ≈ 1.08 = 8% push over the cut.
function kenBurnsFilter(durSec, zEnd) {
  const frames = Math.max(2, Math.round(durSec * 30));
  const zStep = ((zEnd - 1) / frames).toFixed(6);
  return `zoompan=z='min(zoom+${zStep},${zEnd.toFixed(3)})':d=${frames}:s=1920x1080:fps=30`;
}

// Chroma-key filter for green-screen / blue-screen removal. Accepts the
// shorthand "green" / "blue" or a hex colour ("0x00ff00"). similarity=0.18
// is the standard "moderate spill" preset; blend=0.08 softens the alpha edge.
function chromaKeyFilter(spec) {
  if (!spec) return "";
  const colour = spec === "green" ? "0x00ff00" : spec === "blue" ? "0x0000ff" : spec;
  return `chromakey=color=${colour}:similarity=0.18:blend=0.08`;
}

// Luma-key knocks out a luma band. spec is the centre threshold (0..1);
// tolerance defaults to 0.1 (covers the band ±10%) and softness to 0.05.
function lumaKeyFilter(spec) {
  const t = Number.parseFloat(spec);
  if (!Number.isFinite(t)) return "";
  return `lumakey=threshold=${t.toFixed(3)}:tolerance=0.10:softness=0.05`;
}

// Per-cut transform: "scale:1.2,rot:5,x:50,y:-20". Position is pixels; scale
// is a multiplier; rotation is degrees. Empty values are no-ops. Applied via
// scale → rotate (with transparent fill) → pad-back-to-frame.
function transformFilter(spec) {
  if (!spec) return "";
  const parts = {};
  for (const kv of spec.split(",")) {
    const [k, v] = kv.split(":");
    if (k && v !== undefined) parts[k.trim()] = parseFloat(v);
  }
  const chain = [];
  if (Number.isFinite(parts.scale) && parts.scale !== 1) chain.push(`scale=iw*${parts.scale.toFixed(3)}:ih*${parts.scale.toFixed(3)}`);
  if (Number.isFinite(parts.rot) && parts.rot !== 0) chain.push(`rotate=${(parts.rot * Math.PI / 180).toFixed(5)}:ow=rotw(${(parts.rot * Math.PI / 180).toFixed(5)}):oh=roth(${(parts.rot * Math.PI / 180).toFixed(5)}):c=black@0`);
  if (Number.isFinite(parts.x) || Number.isFinite(parts.y)) {
    const dx = Number.isFinite(parts.x) ? parts.x : 0;
    const dy = Number.isFinite(parts.y) ? parts.y : 0;
    chain.push(`pad=iw+${Math.abs(dx) * 2}:ih+${Math.abs(dy) * 2}:${Math.max(0, dx)}:${Math.max(0, dy)}:color=black@0`);
  }
  return chain.join(",");
}

// Mattes: "circle:0.4" cuts a circular alpha matte at radius * min(w,h);
// "rect:0.8x0.3@0,0" cuts a rectangle of (w·0.8 × h·0.3) centred at (cx+dx, cy+dy).
// Returns an ffmpeg filter chain that produces an alpha-masked clip suitable
// for compositing over a black background by downstream stages.
function maskFilter(spec) {
  if (!spec) return "";
  const m = spec.match(/^circle:([\d.]+)$/);
  if (m) {
    const r = parseFloat(m[1]);
    return `format=yuva420p,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(pow(X-W/2,2)+pow(Y-H/2,2),pow(${r}*min(W,H),2)),255,0)'`;
  }
  const rect = spec.match(/^rect:([\d.]+)x([\d.]+)(?:@([\d.\-]+),([\d.\-]+))?$/);
  if (rect) {
    const rw = parseFloat(rect[1]), rh = parseFloat(rect[2]);
    const dx = rect[3] ? parseFloat(rect[3]) : 0, dy = rect[4] ? parseFloat(rect[4]) : 0;
    return `format=yuva420p,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(between(X,(W/2-W*${rw}/2)+W*${dx},(W/2+W*${rw}/2)+W*${dx})*between(Y,(H/2-H*${rh}/2)+H*${dy},(H/2+H*${rh}/2)+H*${dy}),255,0)'`;
  }
  return "";
}

// Per-section grade nudge: verse-cool, chorus-warm, others neutral. Subtle
// (~3% on shadows + mids) so it reads as mood not as a different look.
function sectionGradeFilter(sec) {
  if (sec === "verse") return "colorbalance=bs=0.06:bm=0.04:rs=-0.04:rm=-0.02";
  if (sec === "chorus") return "colorbalance=rs=0.06:rm=0.04:bs=-0.04:bm=-0.02";
  return "";
}

// Shot-matching colour grade: nudge per-clip luma + saturation toward the
// hero shot. Keeps multi-camera coverage from looking like multiple cameras.
function matchColorFilter(shot, hero) {
  if (!hero || shot === hero) return "";
  const dLuma = (hero.lumaAvg - shot.lumaAvg) / 255;
  const heroSat = Math.max(1, hero.satAvg);
  const shotSat = Math.max(1, shot.satAvg);
  const satRatio = Math.max(0.6, Math.min(1.6, heroSat / shotSat));
  if (Math.abs(dLuma) < 0.02 && Math.abs(satRatio - 1) < 0.05) return "";
  return `eq=brightness=${dLuma.toFixed(3)}:saturation=${satRatio.toFixed(3)}`;
}

// FPS used for transition rounding in the plan; the renderer can pick a
// different output rate, the math only uses it to convert
// transition-seconds to frames.
const FPS = 30000 / 1001;

// Returns:
//   { cuts: [{srcIdx, srcInSec, durSec, tOnTimeline, sec}],
//     transitions: [{tOnTimeline, durSec, kind}],
//     titles: [{tOnTimeline, durSec, text}],
//     totalSec, beatSec }
export function build(style, bars, bpm, opts) {
  const clipDurations = opts.clipDurations;
  const projectName = opts.projectName || "FCP CUT";
  const seed = opts.seed || 0;
  const ranked = opts.ranked || null;
  const hookSec = Number.isFinite(opts.hookSec) ? opts.hookSec : 3.5;
  if (seed) reseed(seed);
  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;
  const totalSec = bars * barSec;

  const cuts = [];
  const transitions = [];
  let cutGlobalIdx = 0;
  let prevSec = null;
  let prevShot = null;
  const sectionCutCounts = { intro: 0, verse: 0, chorus: 0, outro: 0 };
  let hookCutCount = 0;
  const matchCuts = opts.matchCuts !== false;

  for (let bar = 0; bar < bars; bar++) {
    const barT = bar * barSec;
    const sec = sectionOf(bar, bars);
    const sectionChanged = prevSec !== null && prevSec !== sec;
    const cutPlan = planBarCuts(style, bars, bar);

    for (let i = 0; i < cutPlan.length; i++) {
      const c = cutPlan[i];
      const tOnTimeline = barT + c.beatStart * beatSec;
      let durSec = c.beatLen * beatSec;
      let srcIdx, srcInSec;
      let pickedShot = null;
      if (ranked) {
        const hookIdx = tOnTimeline < hookSec ? hookCutCount++ : -1;
        const shot = pickShotForCut(ranked, sec, sectionCutCounts[sec] || 0, hookIdx, matchCuts ? prevShot : null);
        srcIdx = shot.clipIdx;
        srcInSec = shot.start;
        const shotLen = Math.max(0.2, shot.end - shot.start - 0.05);
        durSec = Math.min(durSec, shotLen);
        if (hookIdx < 0) sectionCutCounts[sec] = (sectionCutCounts[sec] || 0) + 1;
        prevShot = shot;
        pickedShot = shot;
      } else {
        srcIdx = pickClipIndex(style, cutGlobalIdx, clipDurations.length);
        const srcDur = clipDurations[srcIdx] || durSec;
        srcInSec = Math.max(0, ((cutGlobalIdx * 0.7) % Math.max(0.1, srcDur - durSec - 0.1)));
      }
      const cut = { srcIdx, srcInSec, durSec, tOnTimeline, sec };
      const parts = [];
      if (opts.chromaKey) {
        const ck = chromaKeyFilter(opts.chromaKey);
        if (ck) parts.push(ck);
      }
      if (opts.lumaKey) {
        const lk = lumaKeyFilter(opts.lumaKey);
        if (lk) parts.push(lk);
      }
      if (opts.mask) {
        const mk = maskFilter(opts.mask);
        if (mk) parts.push(mk);
      }
      if (opts.transform) {
        const tx = transformFilter(opts.transform);
        if (tx) parts.push(tx);
      }
      if (pickedShot && opts.shotMatch !== false && ranked.hook) {
        const mc = matchColorFilter(pickedShot, ranked.hook);
        if (mc) parts.push(mc);
      }
      if (opts.sectionGrade !== false) {
        const sg = sectionGradeFilter(sec);
        if (sg) parts.push(sg);
      }
      if (pickedShot && opts.kenBurns !== false && durSec >= 0.5 && pickedShot.motionAvg < 1.0) {
        parts.push(kenBurnsFilter(durSec, 1.08));
      }
      if (parts.length > 0) cut.vFilter = parts.join(",");
      cuts.push(cut);

      if (sectionChanged && i === 0) {
        const tFrames = transitionFrames(style, true, FPS);
        if (tFrames > 0) {
          transitions.push({
            tOnTimeline,
            durSec: tFrames / FPS,
            kind: "xfade",
          });
        }
      }
      cutGlobalIdx++;
    }
    prevSec = sec;
  }

  const titlesRaw = planTitles(bars, projectName);
  const titles = titlesRaw.map((t) => ({ tOnTimeline: t.barIdx * barSec, durSec: t.holdBars * barSec, text: t.text }));

  // Establishing-shot opener: prepend a single low-motion wide shot for the
  // first establishingSec seconds, then shift everything else forward.
  const estSec = Number.isFinite(opts.establishingSec) ? opts.establishingSec : 0;
  if (estSec > 0 && ranked && ranked.verse && ranked.verse.length > 0) {
    const shot = ranked.verse[ranked.verse.length - 1];
    cuts.forEach((c) => { c.tOnTimeline += estSec; });
    transitions.forEach((t) => { t.tOnTimeline += estSec; });
    titles.forEach((t) => { t.tOnTimeline += estSec; });
    cuts.unshift({ srcIdx: shot.clipIdx, srcInSec: shot.start, durSec: Math.min(estSec, shot.end - shot.start), tOnTimeline: 0, sec: "intro", vFilter: kenBurnsFilter(estSec, 1.04) });
  }
  const totalSecOut = totalSec + estSec;

  const brolls = (ranked && opts.brolls)
    ? planBrolls(ranked, sectionOf, bars, barSec).map((b) => ({ srcIdx: b.clipIdx, srcInSec: b.srcInSec, durSec: b.durSec, tOnTimeline: b.tOnTimeline + estSec }))
    : [];

  let snappedCuts = opts.audioOnsets && opts.audioOnsets.length > 0
    ? snapCutsToOnsets(cuts, opts.audioOnsets, opts.audioSnapTolerance || 0.15)
    : cuts;

  if (opts.multicam && opts.clipPaths) {
    snappedCuts = applyMulticamAlternation(snappedCuts, groupMulticam(opts.clipPaths), opts.clipPaths);
  }

  return { cuts: snappedCuts, transitions, titles, brolls, totalSec: totalSecOut, beatSec };
}
