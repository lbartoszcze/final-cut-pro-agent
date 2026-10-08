// Real test of `cut fcp`'s grammar through the installed entry point
// (bin/cut.mjs → bin/fcp.mjs): help names the objects and their verbs, an
// unknown object or verb and the retired one-off verbs are refused naming
// the command, a verb missing its words is refused with its usage, and
// `app status` answers whether Final Cut Pro is running. None of these
// touches Final Cut Pro's window; `app status` only reads the process list.
//
//   node --test tests/cli/fcp.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '../..');
// One `cut fcp` call, its words written as the operator types them.
const cut = (line) => spawnSync(process.execPath, ['bin/cut.mjs', 'fcp', ...line.split(' ')], { cwd: root, encoding: 'utf8' });

function refused(line, message) {
  const result = cut(line);
  assert.ok(result.status, `cut fcp ${line} succeeded: ${result.stdout}`);
  assert.match(result.stderr, message);
}

test('help prints the usage of the grouped primitives', () => {
  const help = cut('help');
  assert.ok(!help.status, help.stderr);
  assert.match(help.stdout, /cut fcp menu click <top> \[<submenu>\.\.\.\] <leaf>/);
  assert.match(help.stdout, /cut fcp ax set <attr> <needle> <value>/);
  assert.match(help.stdout, /cut fcp browser apply <name> --panel/);
  assert.match(help.stdout, /cut fcp dialog press <label>/);
  assert.match(help.stdout, /cut fcp app status/);
});

test('an unknown object or verb is refused naming the command', () => {
  refused('sideways', /unknown command: cut fcp sideways/);
  refused('menu', /unknown command: cut fcp menu/);
  refused('menu sideways', /unknown command: cut fcp menu sideways/);
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

test('app status answers whether Final Cut Pro is running', () => {
  const status = cut('app status');
  assert.ok(!status.status, status.stderr);
  assert.match(status.stdout, /^running: (yes|no)$/m);
});
