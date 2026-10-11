// Real CLI grammar and non-dispatch checks on a dedicated macOS host.
// Final Cut Pro must initially be stopped. The test never starts or stops it.
// FCP_QUALIFICATION_FIXTURE names the source revision and declared exit codes.
// node --test tests/cli/fcp.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
assert.ok(process.env.FCP_QUALIFICATION_FIXTURE, 'FCP_QUALIFICATION_FIXTURE is required');
const fixture = JSON.parse(readFileSync(process.env.FCP_QUALIFICATION_FIXTURE, 'utf8'));
assert.ok(Number.isSafeInteger(fixture.successExit), 'fixture.successExit must declare the successful process exit code');
assert.ok(Number.isSafeInteger(fixture.usageExit), 'fixture.usageExit must declare the CLI usage-error exit code');
assert.notEqual(fixture.successExit, fixture.usageExit);
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
assert.equal(revision.status, fixture.successExit, revision.stderr);
assert.equal(revision.stdout.trim(), fixture.revision, 'fixture.revision must identify this checkout');
const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
assert.equal(dirty.status, fixture.successExit, dirty.stderr);
assert.equal(dirty.stdout, '', 'qualification requires committed source');
const evidence = resolve(root, 'target/real-tests/fcp', randomUUID());
mkdirSync(evidence, { recursive: true });
const report = { revision: fixture.revision, commands: [] };
const cut = (line) => {
  const args = ['bin/cut.mjs', 'fcp', ...line.split(' ')];
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  report.commands.push({ executable: process.execPath, args, status: result.status, signal: result.signal,
    stdout: result.stdout, stderr: result.stderr, error: result.error?.message });
  writeFileSync(resolve(evidence, 'commands.json'), JSON.stringify(report, null, '\t'));
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
};

before(() => {
  const initial = cut('app status');
  assert.equal(initial.status, fixture.successExit, initial.stderr);
  assert.match(initial.stdout, /^running: no$/m, 'use a dedicated host with Final Cut Pro initially stopped');
});

after(() => {
  const final = cut('app status');
  assert.equal(final.status, fixture.successExit, final.stderr);
  assert.match(final.stdout, /^running: no$/m, 'help and rejected input must not launch Final Cut Pro');
});

function refused(line, message) {
  const result = cut(line);
  assert.equal(result.status, fixture.usageExit, `cut fcp ${line}: ${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, message);
}


test('an unknown object or verb is refused naming the command', () => {
  refused('sideways', /unknown command: cut fcp sideways/);
  refused('menu', /unknown command: cut fcp menu/);
  refused('menu sideways', /unknown command: cut fcp menu sideways/);
  refused('constructor', /constructor/);
  refused('__proto__', /__proto__/);
});

test('the retired one-off verbs are unknown commands', () => {
  refused('ax-get AXValue Opacity', /unknown command: cut fcp ax-get/);
  refused('apply-effect Vignette', /unknown command: cut fcp apply-effect/);
  refused('volume-up', /unknown command: cut fcp volume-up/);
  refused('wrappers', /unknown command: cut fcp wrappers/);
  refused('open cut.fcpxml', /unknown command: cut fcp open/);
});

test('a verb missing its words is refused with its usage', () => {
  refused('menu click Edit', /usage: cut fcp menu click/);
  refused('browser apply Vignette', /browser apply needs --panel/);
  refused('ax set AXValue Opacity', /usage: cut fcp ax set/);
  refused('dialog press', /usage: cut fcp dialog press/);
  refused('app open', /usage: cut fcp app open/);
});

test('group and leaf help succeeds without launching Final Cut Pro', () => {
  for (const command of ['help', 'app --help', 'menu -h', 'browser --help', 'ax --help', 'dialog -h',
    'app launch --help', 'app open --help', 'menu click --help', 'browser apply --help',
    'ax set --help', 'dialog press --help']) {
    const result = cut(command);
    assert.equal(result.status, fixture.successExit, `${command}: ${result.stderr}`);
    assert.equal(result.stderr, '', command);
  }
});

test('zero-operand primitives refuse extra input before dispatch', () => {
  for (const command of ['app status', 'app launch', 'menu list', 'ax dump']) {
    refused(`${command} unintended-operand`, /unintended-operand/);
  }
});

