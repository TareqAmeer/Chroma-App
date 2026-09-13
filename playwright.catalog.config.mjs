// Dedicated config for test/catalog_visual.mjs ONLY — split out of playwright.config.mjs
// 2026-09-13 because that shared config hard-codes `fullyParallel:false, workers:2` for a real
// reason (test/*_behaviour.mjs and library_dock_states.mjs/library_flag_state_leak.mjs mutate
// shared localStorage/theme state, so their tests must not race each other). catalog_visual.mjs
// has none of that: every test does its own `page.goto` into a fresh, isolated Playwright context
// (no shared page/localStorage across tests), sets its own theme per test rather than assuming
// one left by a previous test, and its `base` server fixture is `scope:'worker'` — an ephemeral
// per-worker static server, not a single shared one. It was still forced onto the shared config's
// one-worker-per-file default (Playwright without `fullyParallel` runs one worker per test FILE),
// making its own 100 sub-tests the long pole of `editor:gates` at ~13 minutes serial, regardless
// of how many OTHER gates ran alongside it. Splitting its config out and turning fullyParallel on
// here doesn't touch the other three suites' serial guarantee at all.
import { defineConfig } from '@playwright/test';
import { DETERMINISTIC_LAUNCH_ARGS, DETERMINISTIC_CONTEXT_OPTIONS } from './test/wireframe_diff_lib.mjs';

export default defineConfig({
  testDir: './test',
  testMatch: /catalog_visual\.mjs$/,
  fullyParallel: true,
  // Fixed at 4 rather than Playwright's own CPU-based default: tried unbounded once (2026-09-13)
  // and got 2 real-looking failures that were pure timing flakes under contention (confirmed by
  // re-running just those two in isolation — both passed clean) once several other gates' own
  // browsers were also alive at once. 4 measured ~2x faster than the old forced-serial run
  // (13.1m -> 7.1m) without reproducing that flake in a follow-up run. Override with `--workers=N`.
  workers: 4,
  reporter: process.env.CI ? 'list' : [['list']],
  retries: 0,
  timeout: 30000,
  expect: { timeout: 8000 },
  use: {
    ...DETERMINISTIC_CONTEXT_OPTIONS,
    viewport: { width: 960, height: 900 },
    launchOptions: { args: DETERMINISTIC_LAUNCH_ARGS },
    trace: 'retain-on-failure',
  },
});
