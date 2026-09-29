"""
Rolling history of run summaries (freeze count, error count, memory slope)
so a single run's numbers get judged against recent history instead of in
isolation — "3 freezes this run vs 0 in the last 5" is a signal; "3
freezes" alone is not.

Follows test/baselines/*.json's own convention of a plain JSON file
committed to nothing — this one lives under diagnostics/ (gitignored
alongside reports/, since it's local run history, not a CI gate).
"""
import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
BASELINE_PATH = os.path.join(ROOT, 'baseline.json')
MAX_HISTORY = 20


def load():
    if not os.path.exists(BASELINE_PATH):
        return {'runs': []}
    try:
        with open(BASELINE_PATH) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError, ValueError):
        return {'runs': []}


def save(data):
    with open(BASELINE_PATH, 'w') as f:
        json.dump(data, f, indent=2)


def _avg(values):
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None


def compare_and_record(run_id, summary):
    """
    Append this run's summary to history and return a comparison dict
    against the average of prior runs (before this one was added).

    Idempotent per run_id: re-rendering a report (e.g. `cli.py report
    --run <id>`) recomputes the comparison against the same prior history
    instead of re-appending and skewing the rolling average.
    """
    data = load()
    data['runs'] = [r for r in data['runs'] if r['run_id'] != run_id]
    prior = data['runs'][-9:]  # last up to 9 prior runs

    freeze_count = len(summary['freezes'])
    error_count = len(summary['errors'])
    mem_slope = summary['memory']['slope_mb_per_min'] if summary['memory'] else None

    comparison = {
        'freeze_count': freeze_count,
        'error_count': error_count,
        'mem_slope': mem_slope,
        'prior_avg_freeze_count': _avg([r['freeze_count'] for r in prior]),
        'prior_avg_error_count': _avg([r['error_count'] for r in prior]),
        'prior_avg_mem_slope': _avg([r['mem_slope'] for r in prior]),
        'prior_run_count': len(prior),
    }

    data['runs'].append({
        'run_id': run_id,
        'freeze_count': freeze_count,
        'error_count': error_count,
        'mem_slope': mem_slope,
    })
    data['runs'] = data['runs'][-MAX_HISTORY:]
    save(data)
    return comparison


def render_comparison(comparison):
    if comparison['prior_run_count'] == 0:
        return "No prior runs recorded yet — this becomes the first baseline point."
    lines = []
    lines.append(
        f"Freezes: {comparison['freeze_count']} "
        f"(prior avg over {comparison['prior_run_count']} runs: "
        f"{comparison['prior_avg_freeze_count']:.1f})"
    )
    lines.append(
        f"Errors: {comparison['error_count']} "
        f"(prior avg: {comparison['prior_avg_error_count']:.1f})"
    )
    if comparison['mem_slope'] is not None and comparison['prior_avg_mem_slope'] is not None:
        lines.append(
            f"Memory slope: {comparison['mem_slope']:.2f} MB/min "
            f"(prior avg: {comparison['prior_avg_mem_slope']:.2f})"
        )
    return '\n'.join(lines)
