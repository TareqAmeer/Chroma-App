// Per-control behaviour-test stubs — one describe block per panel, one test.skip per linked
// wireframe control. Generated from test/generated_pairs.mjs's CONTROL_PAIRS. Un-skip a test
// once the control's behaviour is implemented and ready to verify.
//
// Run: npx playwright test test/editor_wireframe_control_tests.mjs
// This is a NEW file (task 3) — the existing 1003-line editor_wireframe_behaviour.mjs is
// section-level; this covers per-control fidelity from data-app links.
import { test, expect } from '@playwright/test';
import { CONTROL_PAIRS } from './generated_pairs.mjs';

const byPanel = {};
for (const cp of CONTROL_PAIRS) {
  (byPanel[cp.panel] ??= []).push(cp);
}

for (const [panel, controls] of Object.entries(byPanel)) {
  test.describe(`${panel} panel controls`, () => {
    for (const ctrl of controls) {
      test.skip(`${ctrl.label || ctrl.app} responds to interaction`, async ({ page }) => {
        // Stub: navigate to app, activate panel, locate control by app selector, interact, assert.
        // Un-skip and fill in when the control's behaviour spec is ready.
        await page.goto('http://localhost:8000/chromasmith-22.html?libtest=1&deskx=1');
        const el = page.locator(ctrl.app);
        await expect(el).toBeVisible();
      });
    }
  });
}
