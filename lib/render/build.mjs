// Cut planner for the direct ffmpeg renderer. Pure schedule-list math.
// Mirrors logic-pro-agent/lib/render/build.mjs in role: turns style + bars
// + bpm into per-clip cuts + transitions + title overlays. No ffmpeg, no
// fcpxml emission — that lives in synth.mjs / video.mjs.

import { reseed, sectionOf, planBarCuts, transitionFrames, planTitles, pickClipIndex } from "../edit.mjs";

// FPS used for transition rounding in the plan; the renderer can pick a
// different output rate, the math only uses it to convert
// transition-seconds to frames.
const FPS = 30000 / 1001;

// Returns:
//   { cuts: [{srcIdx, srcInSec, durSec, tOnTimeline, sec}],
//     transitions: [{tOnTimeline, durSec, kind}],
//     titles: [{tOnTimeline, durSec, text}],
//     totalSec, beatSec }
export function build(style, bars, bpm, { clipDurations, projectName = "FCP CUT", seed = 0 }) {
  if (seed) reseed(seed);
  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;
  const totalSec = bars * barSec;

  const cuts = [];
  const transitions = [];
  let cutGlobalIdx = 0;
  let prevSec = null;

  for (let bar = 0; bar < bars; bar++) {
    const barT = bar * barSec;
    const sec = sectionOf(bar, bars);
    const sectionChanged = prevSec !== null && prevSec !== sec;
    const cutPlan = planBarCuts(style, bars, bar);

    for (let i = 0; i < cutPlan.length; i++) {
      const c = cutPlan[i];
      const tOnTimeline = barT + c.beatStart * beatSec;
      let durSec = c.beatLen * beatSec;
      const srcIdx = pickClipIndex(style, cutGlobalIdx, clipDurations.length);
      // Pick a deterministic in-point — wraparound across the source so
      // repeated clips don't always start at 0.
      const srcDur = clipDurations[srcIdx] || durSec;
      const inOffset = ((cutGlobalIdx * 0.7) % Math.max(0.1, srcDur - durSec - 0.1));
      const srcInSec = Math.max(0, inOffset);
      cuts.push({ srcIdx, srcInSec, durSec, tOnTimeline, sec });

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
  const titles = titlesRaw.map((t) => ({
    tOnTimeline: t.barIdx * barSec,
    durSec: t.holdBars * barSec,
    text: t.text,
  }));

  return { cuts, transitions, titles, totalSec, beatSec };
}
