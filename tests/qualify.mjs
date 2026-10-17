#!/usr/bin/env node
// Qualifies one committed revision of final-cut-pro-agent by its journeys,
// for a defect register's revision-bound completion probe:
//
//   node tests/qualify.mjs <revision> <journey>...
//
// where a journey is a path below tests/ without .test.mjs (measure/probes, cli/fcp).
// The revision's committed tree is exported with git archive into
// target/qualify/<commit> of this checkout, and each
// journey runs there with node --test, so neither another session's
// uncommitted edit nor a later test reads in. Standard output lists the
// journeys that failed, one per line, and is empty when every one passed;
// the journeys' own output goes to standard error. A revision git cannot
// name or export ends the run as failed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// argv holds node and this script before the caller's words.
const [, , revision, ...journeys] = process.argv;
assert.ok(revision && journeys.length, 'usage: node tests/qualify.mjs <revision> <journey>...');
const succeeded = spawnSync('true').status;

const resolved = spawnSync('git', ['-C', root, 'rev-parse', '--verify', `${revision}^{commit}`], { encoding: 'utf8' });
assert.equal(resolved.status, succeeded, `git cannot name ${revision} as a commit: ${resolved.stderr}`);
const commit = resolved.stdout.trim();
const exported = join(root, 'target', 'qualify', commit);
rmSync(exported, { recursive: true, force: true });
mkdirSync(exported, { recursive: true });
const archive = spawnSync('git', ['-C', root, 'archive', '--format=tar', commit], { maxBuffer: Infinity });
assert.equal(archive.status, succeeded, `git archive ${commit} failed: ${archive.stderr}`);
const unpacked = spawnSync('tar', ['-x', '-C', exported], { input: archive.stdout });
assert.equal(unpacked.status, succeeded, `tar could not unpack ${commit}: ${unpacked.stderr}`);

for (const name of journeys) {
  const path = join(exported, 'tests', `${name}.test.mjs`);
  if (!existsSync(path)) {
    console.log(`${name}: no such journey at ${commit}`);
    continue;
  }
  const ran = spawnSync(process.execPath, ['--test', path], {
    cwd: exported,
    stdio: ['ignore', process.stderr, process.stderr],
  });
  if (ran.status !== succeeded) console.log(`${name}: failed (${ran.status ?? ran.signal})`);
}
