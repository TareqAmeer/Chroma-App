#!/usr/bin/env node
// Cross-platform stand-in for `if [ -x .calibvenv/bin/python3 ]; then .calibvenv/bin/python3 "$@";
// else python3 "$@"; fi` (docs/windows-port.md ground rule 4: cross-platform scripts in Node,
// not bash). That inline shell conditional worked fine in a real bash/zsh, but npm on Windows
// runs package.json scripts through cmd.exe by default, where `[ -x ... ]` is a syntax error
// ("-x was unexpected at this time"), blocking `npm run tokens:verify`/`npm run scorecard`
// (and, via githooks/pre-commit, every commit touching chromasmith-22.html/library-ui.js) on
// Windows regardless of which shell invoked `npm run`.
//
// The venv path and the system-Python fallback command are both OS-specific, not just the
// conditional syntax: `python3` on a stock Windows PATH commonly resolves to the Microsoft
// Store's execution-alias stub rather than a real interpreter (the same trap documented for
// bump-build-stamp.sh's python3 call, docs/windows-port.md G15) — confirmed live on this
// machine (`python3 --version` prints the Store install-prompt message; `python --version`
// finds the real 3.11 install). `python` is therefore the correct Windows fallback, `python3`
// the correct macOS one; picking the wrong one either fails outright (Windows) or risks Python 2
// (macOS, where `python` is unqualified).
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const isWin = process.platform === 'win32';
const venvPython = join('.calibvenv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python3');
const python = existsSync(venvPython) ? venvPython : isWin ? 'python' : 'python3';

const result = spawnSync(python, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  console.error(`run-python: could not launch "${python}": ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
