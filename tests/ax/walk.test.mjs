// The AppleScript every Final Cut Pro accessibility helper sends, as
// elementWalk builds it, read here without sending it: a walk with a refusal
// stops at the first element its test holds for and errors with the refusal
// when none does; a walk without one visits every element and returns `acc`;
// `topmost` walks window 1 only; and text a caller names is escaped, so it
// can never end an AppleScript string and add code. No osascript runs.
//
//   node --test tests/ax/walk.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { asEsc, elementWalk, labelled } from '../../lib/fcp-ax.mjs';

const lines = (script) => script.split('\n').map((line) => line.trim()).filter(Boolean);

test('a walk with a refusal stops at the first match and errors with the refusal when none matched', () => {
  const script = lines(elementWalk({ test: labelled('Share'), act: 'perform action "AXPress" of e', refusal: 'no element matching: Share' }));
  const acted = script.indexOf('perform action "AXPress" of e');
  assert.deepEqual(script.slice(acted, acted + 3), ['perform action "AXPress" of e', 'set done to true', 'exit repeat']);
  assert.ok(script.includes('if done then exit repeat'), 'the window loop does not stop after the first match');
  assert.equal(script.at(-3), 'if not done then error "no element matching: Share"');
  assert.ok(!script.includes('return acc'));
  assert.ok(script.includes('repeat with w in windows'), 'a walk that is not topmost reads every window');
});

test('a walk without a refusal visits every element and returns acc', () => {
  const script = lines(elementWalk({ test: 'true', act: 'set acc to acc & (role of e) & linefeed' }));
  assert.equal(script.at(-3), 'return acc');
  assert.ok(!script.includes('exit repeat') && !script.includes('if done then exit repeat'), 'a collecting walk stops early');
  assert.ok(!script.some((line) => line.startsWith('if not done then error')));
});

test('a topmost walk reads window 1 only, and none when there is no window', () => {
  const script = lines(elementWalk({ act: 'set acc to acc & (role of e) & linefeed', topmost: true }));
  assert.ok(script.includes('set scanned to {}'));
  assert.ok(script.includes('if (count of windows) > 0 then set scanned to {window 1}'));
  assert.ok(script.includes('repeat with w in scanned'));
  assert.ok(!script.includes('repeat with w in windows'));
  assert.ok(script.includes('if true then'), 'a walk with no test does not visit every element');
});

test('text a caller names is escaped for an AppleScript string', () => {
  const needle = 'x" or true or "\\';
  assert.equal(asEsc(needle), 'x\\" or true or \\"\\\\');
  const script = elementWalk({ test: labelled(asEsc(needle)), act: 'set acc to acc & "hit"', refusal: `no element matching: ${asEsc(needle)}` });
  assert.ok(script.includes('(description of e is "x\\" or true or \\"\\\\")'));
  assert.ok(script.includes('error "no element matching: x\\" or true or \\"\\\\"'));
});
