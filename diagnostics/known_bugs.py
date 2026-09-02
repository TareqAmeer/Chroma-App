"""
Pattern-match captured events against bug classes CLAUDE.md already
documents as having burned real debugging time in this codebase, so a
report says "possible match: quiet shader bug" instead of leaving Claude
to rediscover a known failure mode from scratch.
"""
import re
from collections import defaultdict

PATTERNS = [
    (re.compile(r'GLSL (compile|link) error', re.I), 'quiet-shader-bug',
     "CLAUDE.md §3: a GLSL compile/link failure doesn't crash the app — the affected "
     "shader program just silently renders as if switched off. Check for a reserved GLSL ES "
     "word (half, input, output, filter, sample, cast, union, this, double) or a stray "
     "backtick/${ inside a shader comment."),
    (re.compile(r'catalog\.corrupt-\d+\.db'), 'catalog-corruption',
     "catalog.rs set aside a corrupted DB automatically (its own incident-trail naming). "
     "Check recent Library boot/scan activity and whether CS_CATALOG_DIR was in play."),
    (re.compile(r'CONTEXT_LOST_WEBGL|\b37442\b'), 'webgl-context-lost',
     "Known flaky SwiftShader/driver event documented against test/export_harness.mjs — "
     "not necessarily an app regression. Confirm by re-running before chasing it as a bug."),
    (re.compile(r"origin\s*!==\s*'ai'|origin\s*===\s*'ai'"), 'ai-origin-comparison',
     "CLAUDE.md §5b: a raw origin==='ai'/!=='ai' comparison outside mskIsAI() is a known "
     "bug class — a Skin mask can silently do nothing. Run `npm run lint:ai`."),
    (re.compile(r'LINK FAILED', re.I), 'shader-link-failed',
     "Pairs with the quiet-shader-bug class above — a program failed to link and the "
     "feature it drives will look switched off rather than erroring visibly."),
    (re.compile(r'PANIC:'), 'native-panic',
     "A Rust panic was caught by diag.rs's panic hook (this codebase's first — previously "
     "invisible outside a terminal entirely). Very likely the direct cause of a crash/restart "
     "near this timestamp; check the message for the panicking function and file:line."),
]

REPEAT_LOOP_WINDOW_S = 30.0
REPEAT_LOOP_THRESHOLD = 5


def match_text(text):
    """Return list of (bug_id, explanation) for any pattern matching text."""
    if not text:
        return []
    hits = []
    for pattern, bug_id, explanation in PATTERNS:
        if pattern.search(text):
            hits.append((bug_id, explanation))
    return hits


def match_events(events):
    """Scan every event's message-like fields for known bug-class patterns."""
    results = []
    for e in events:
        text = ' '.join(str(e.get(k, '')) for k in ('msg', 'cmd', 'kind') if e.get(k))
        for bug_id, explanation in match_text(text):
            results.append({'ts': e.get('ts'), 'event': e, 'bug_id': bug_id, 'explanation': explanation})
    return results


def detect_repeat_loops(events, window_s=REPEAT_LOOP_WINDOW_S, threshold=REPEAT_LOOP_THRESHOLD):
    """
    Flag a burst of near-identical log/error lines in a short window — the
    shape of the "hq_offline retried a permanently-stuck camera forever"
    class of bug: no single line looks wrong, but the same one repeating
    without progress is the tell.
    """
    candidates = [e for e in events if e.get('category') in ('error', 'native_log')]
    buckets = defaultdict(list)
    for e in candidates:
        key = (e.get('kind'), (e.get('msg') or '')[:80])
        buckets[key].append(e['ts'])

    loops = []
    for (kind, msg_prefix), timestamps in buckets.items():
        timestamps.sort()
        i = 0
        for j in range(len(timestamps)):
            while timestamps[j] - timestamps[i] > window_s:
                i += 1
            count = j - i + 1
            if count >= threshold:
                loops.append({
                    'kind': kind, 'msg_prefix': msg_prefix,
                    'count': count, 'window_s': window_s,
                    'first_ts': timestamps[i], 'last_ts': timestamps[j],
                })
                break
    return loops
