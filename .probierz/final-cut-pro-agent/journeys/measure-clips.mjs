#!/usr/bin/env node
// measure-clips: how the agent measures source clips with the installed
// ffprobe and ffmpeg: a file that is not media is refused with ffprobe's
// words, a clip without audio has a length and no loudness, a clip with a
// tone has a measured loudness, as tests/measure/probes.test.mjs checks it
// on files it generates.
//
// The run names WISENT_WORKSPACE, the folder holding the checkout.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const workspace = process.env.WISENT_WORKSPACE?.trim();
if (!workspace) {
  process.stderr.write('WISENT_WORKSPACE is not set: run this journey through `probierz run tui --app final-cut-pro-agent`\n');
  // Usage refusal: https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
  process.exit(2);
}
const result = spawnSync(process.execPath, ['--test', 'tests/measure/probes.test.mjs'], { cwd: join(workspace, 'final-cut-pro-agent'), stdio: 'inherit', env: process.env });
// EXIT_FAILURE when the test runner reports no status: https://pubs.opengroup.org/onlinepubs/9799919799/functions/exit.html
process.exit(result.status ?? 1);
