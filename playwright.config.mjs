// Config for the @playwright/test-based suites ONLY (currently test/wireframe_behaviour.mjs).
//
// ⚠️ Every OTHER test in test/ is a plain `node test/foo.mjs` script driving raw `playwright`
// (chromium.launch()), not this runner — see package.json's script list. Do not point
// `testDir` at all of test/ or the runner will try to execute those scripts as spec files.
// The two conventions coexist deliberately: the raw scripts predate this and work; the runner
// is used where auto-retrying web-first assertions materially reduce flake, which is the case
// for interaction tests (Playwright's own guidance names fixed sleeps as the main flake source,
// and this repo already has two harnesses documented as flaky in CLAUDE.md for that reason).
import { defineConfig } from '@playwright/test';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS } from './test/wireframe_diff_lib.mjs';

export default defineConfig({
  testDir: './test',
  testMatch: /wireframe_behaviour\.mjs$/,
  // Interactions mutate localStorage; workers must not share a profile or a section-collapse
  // test would race a theme test. Playwright gives each worker its own context by default —
  // this just keeps the count low enough that the shared static server isn't the bottleneck.
  workers: 2,
  fullyParallel: false,
  reporter: process.env.CI ? 'list' : [['list'], ['json', { outputFile: 'test/output/behaviour_report.json' }]],
  // No retries: a behaviour test that only passes on retry is hiding a real race in the app.
  retries: 0,
  timeout: 30000,
  expect: { timeout: 8000 },
  use: {
    ...DETERMINISTIC_CONTEXT_OPTIONS,
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: DETERMINISTIC_LAUNCH_ARGS },
    trace: 'retain-on-failure',
  },
});
