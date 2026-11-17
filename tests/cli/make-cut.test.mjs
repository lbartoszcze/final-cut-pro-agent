// A tempo or a bar count make-cut cannot read in base 10 is refused before
// anything is measured or written: --bpm and --bars are parsed with radix 10,
// so a hex value such as 0x78 reads as 0 and is refused naming the flag and
// what was given, never taken as 120 bars or beats. No media tool runs.
//
//   node --test tests/cli/make-cut.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const work = join(root, 'target', 'real-tests', 'make-cut', randomUUID());
mkdirSync(work, { recursive: true });
after(() => rmSync(work, { recursive: true, force: true }));

for (const [flag, value] of [['bpm', '0x78'], ['bars', '0x8']]) {
  test(`--${flag}=${value} is refused naming the flag, and nothing is written`, () => {
    const out = join(work, `${flag}.fcpxml`);
    const run = spawnSync(process.execPath, [join(root, 'bin/make-cut.mjs'), `--${flag}=${value}`, `--out=${out}`], { cwd: work, encoding: 'utf8' });
    assert.ifError(run.error);
    assert.notEqual(run.status, 0, run.stdout);
    assert.match(run.stderr, new RegExp(`bad --${flag}: ${value}`));
    assert.equal(existsSync(out), false, 'a refused cut wrote its project');
  });
}
