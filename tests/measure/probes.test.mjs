// How make-cut measures source clips, run against real files with the
// installed ffprobe and ffmpeg in a run-owned directory under
// target/real-tests/measure/:
//   - a file that is not media is refused by the duration probe and by the
//     audio probe with ffprobe's words, never given a length or read as a
//     clip without audio;
//   - a generated clip without audio has a measured length and no loudness;
//   - a generated clip with a tone has a measured integrated loudness.
//
//   node --test tests/measure/probes.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';

import { ffprobeHasAudio, parseFps, probeLoudness } from '../../lib/render/ffmpeg.mjs';
import { probeDurationFrames } from '../../lib/source/sources.mjs';

const root = resolve(import.meta.dirname, '../..');
const work = join(root, 'target', 'real-tests', 'measure', randomUUID());
mkdirSync(work, { recursive: true });
after(() => rmSync(work, { recursive: true, force: true }));

const fps = parseFps('30');
const rate = fps.num / fps.den;
const notMedia = join(work, 'not-media.mp4');
writeFileSync(notMedia, 'this file holds text, not a video');

test('a file that is not media is refused, not given a length or read as silent', () => {
  assert.throws(() => probeDurationFrames(notMedia, rate), /ffprobe could not read the duration of .*not-media\.mp4/);
  assert.throws(() => ffprobeHasAudio(notMedia), /ffprobe could not read the audio streams of .*not-media\.mp4/);
  assert.throws(() => probeLoudness(notMedia), /ffprobe could not read the audio streams/);
});

// A clip made the same way as the tone clip below, without its audio input.
function clipOf(name, inputs) {
  const clip = join(work, name);
  const made = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=2', ...inputs,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip], { encoding: 'utf8' });
  assert.ifError(made.error);
  assert.equal(made.status, spawnSync('true').status, made.stderr);
  return clip;
}

test('a clip without audio has a measured length and no loudness', () => {
  const clip = clipOf('silent.mp4', []);
  assert.ok(probeDurationFrames(clip, rate) > rate, 'the clip lasts longer than one second');
  assert.equal(ffprobeHasAudio(clip), false);
  assert.equal(probeLoudness(clip), null);
});

test('a clip with a tone has a measured integrated loudness', () => {
  const clip = clipOf('tone.mp4', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:a', 'aac']);
  assert.equal(ffprobeHasAudio(clip), true);
  const loudness = probeLoudness(clip);
  assert.ok(Number.isFinite(loudness.inputI), `integrated loudness ${loudness.inputI}`);
  assert.ok(Number.isFinite(loudness.inputTP), `true peak ${loudness.inputTP}`);
});
