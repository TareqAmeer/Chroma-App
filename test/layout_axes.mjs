// Shared resizable-region axes for the Editor and Library, imported by both
// test/editor_responsive_qa.mjs and test/surface_capture.mjs so their layout matrices can never
// drift apart (docs/ui-workflow/STATE.md S6c). Ranges come from the app's own clamps:
// fxPanelWidth() 220-440 (default 320), library-ui.js LIB_DOCK_MIN/MAX 90-420 (default 120),
// #lib-side-resizer --lib-side-w 150-420 (default 230).
export const LAYOUT_AXES = [
  { resizer: 'fx-rail-resizer', name: 'rail', states: [
    ['labels', `railMode('labels')`], ['icons', `railMode('icons')`]] },
  { resizer: 'fx-panel-resizer', name: 'panel', states: [
    ['220', `document.body.classList.remove('panel-closed');fxPanelWidth(220)`],
    ['320', `document.body.classList.remove('panel-closed');fxPanelWidth(320)`],
    ['440', `document.body.classList.remove('panel-closed');fxPanelWidth(440)`],
    ['closed', `document.body.classList.add('panel-closed')`]] },
  { resizer: 'lib-dock-resizer', name: 'dock', states: [
    ['90', `document.querySelector('.fx-layout').style.setProperty('--dock-w-user','90px')`],
    ['120', `document.querySelector('.fx-layout').style.setProperty('--dock-w-user','120px')`],
    ['420', `document.querySelector('.fx-layout').style.setProperty('--dock-w-user','420px')`]] },
];

// Library sidebar (full-mode only) — added for S6c so surface_capture.mjs's Library whole-window
// shots can reuse the exact same axis definition instead of a second hand-typed set of numbers.
export const LIBRARY_SIDEBAR_AXIS = {
  resizer: 'lib-side-resizer', name: 'sidebar', states: [
    ['150', `document.getElementById('lib-overlay')?.style.setProperty('--lib-side-w','150px')`],
    ['230', `document.getElementById('lib-overlay')?.style.setProperty('--lib-side-w','230px')`],
    ['420', `document.getElementById('lib-overlay')?.style.setProperty('--lib-side-w','420px')`]],
};
