#!/usr/bin/env node
// author-a-cut: an editor hands `cut fcpxml` a folder of footage, a music
// track and captions and gets a Final Cut Pro project with the decisions
// baked in. The journey makes three short clips and a tone track of its own
// with ffmpeg (fixtures, not a render) and asks for a 24 fps cut over 8 bars
// with the captions burned in. The project is FCPXML: an asset for every
// clip and for the music, a sequence at 24 fps whose spine uses the clips,
// the music on an audio lane, and a title carrying each caption's words.
// Footage that is not media is refused naming the file. Final Cut Pro is not
// opened: importing would change the editor's own library.
//
// The run names TUI_CMD (the agent's bin/cut.mjs); ffmpeg and ffprobe are
// on PATH.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    process.stderr.write(`${name} is not set: run this journey through \`probierz run tui --app final-cut-pro-agent\`\n`);
    process.exit(2);
  }
  return value;
}

const cut = required('TUI_CMD');
const own = join(required('PROBIERZ_ARTIFACTS'), 'final-cut');
const footage = join(own, 'footage');
rmSync(own, { recursive: true, force: true });
mkdirSync(footage, { recursive: true });
const ffmpeg = (args) => {
  const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (made.status !== 0) throw new Error(`making a fixture with ffmpeg failed: ${made.stderr.trim()}`);
};

const broken = [];
const expect = (holds, sentence) => {
  if (!holds) broken.push(sentence);
};
try {
  for (const [index, pattern] of ['testsrc2', 'smptebars', 'mandelbrot'].entries()) {
    ffmpeg(['-f', 'lavfi', '-i', `${pattern}=size=1280x720:rate=24`, '-f', 'lavfi', '-i', `sine=frequency=${300 + index * 100}`, '-t', '4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(footage, `clip-${index + 1}.mp4`)]);
  }
  const music = join(own, 'track.m4a');
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=220:beep_factor=4', '-t', '20', '-c:a', 'aac', music]);
  const captions = join(own, 'subs.vtt');
  writeFileSync(captions, 'WEBVTT\n\n00:00:00.500 --> 00:00:02.500\nThe lighthouse keeps watch\n\n00:00:03.000 --> 00:00:05.000\nShips come home safe\n');
  const project = join(own, 'cut.fcpxml');

  const authored = spawnSync(process.execPath, [cut, 'fcpxml', `--clips=${footage}`, `--music=${music}`, '--bars=8', '--fps=24', `--captions=${captions}`, '--caption-lang=en', `--out=${project}`], { encoding: 'utf8', maxBuffer: Infinity });
  expect(authored.status === 0 && existsSync(project), `cut fcpxml did not write the project: ${authored.stderr.trim()}`);
  const xml = existsSync(project) ? readFileSync(project, 'utf8') : '';
  expect(/<fcpxml\s+version="\d+\.\d+"/.test(xml), 'the project is not FCPXML with a version');
  for (const clip of ['clip-1.mp4', 'clip-2.mp4', 'clip-3.mp4', 'track.m4a']) {
    expect(new RegExp(`<asset[^>]*src="[^"]*${clip.replace('.', '\\.')}"`).test(xml), `the project holds no asset for ${clip}`);
  }
  expect(/<format[^>]*frameDuration="(100\/2400s|1\/24s)"/.test(xml), 'the project\'s format is not 24 fps');
  expect(/<spine>[\s\S]*<(asset-clip|clip|ref-clip)\b/.test(xml), 'the sequence\'s spine uses no clip');
  expect(/lane="-\d+"/.test(xml), 'the music is on no audio lane');
  expect(xml.includes('The lighthouse keeps watch') && xml.includes('Ships come home safe'), 'the captions\' words are not in the project');

  writeFileSync(join(footage, 'notes.mp4'), 'not a video at all\n');
  const refused = spawnSync(process.execPath, [cut, 'fcpxml', `--clips=${footage}`, '--fps=24', `--out=${join(own, 'refused.fcpxml')}`], { encoding: 'utf8' });
  expect(refused.status !== 0 && refused.stderr.includes('notes.mp4'), 'footage that is not media was not refused naming the file');
} catch (failure) {
  broken.push(failure.message);
}

if (broken.length > 0) {
  process.stderr.write(`${broken.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('cut authored a 24 fps Final Cut Pro project with every clip, the music and the captions\n');
