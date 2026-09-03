"""
Read-only access to catalog.db for exact-row-state answers on demand —
the deep-dive counterpart to report.md's aggregate summary. Opened via a
`file:...?mode=ro` URI so this never contends with the app's own live
writer connection or risks a stray write.
"""
import os
import sqlite3

DEFAULT_DB_PATH = os.path.expanduser(
    '~/Library/Application Support/com.tareq.chromasmith/catalog.db')


def db_path():
    # Mirrors catalog.rs's own CS_CATALOG_DIR override (CLAUDE.md) for a
    # sandboxed/alternate run.
    override = os.environ.get('CS_CATALOG_DIR')
    if override:
        return os.path.join(override, 'catalog.db')
    return DEFAULT_DB_PATH


def connect():
    path = db_path()
    if not os.path.exists(path):
        raise FileNotFoundError(f"no catalog.db at {path}")
    uri = f"file:{path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def run_sql(sql, params=()):
    """Read-only escape hatch. Raises if the statement isn't a SELECT."""
    stripped = sql.strip().lstrip('(').strip().upper()
    if not stripped.startswith('SELECT') and not stripped.startswith('WITH'):
        raise ValueError("only SELECT/WITH queries are allowed against catalog.db from here")
    with connect() as conn:
        cur = conn.execute(sql, params)
        cols = [d[0] for d in cur.description]
        return cols, [tuple(row) for row in cur.fetchall()]


# Canned queries for the questions that come up while chasing a stall —
# named after what they answer, not the table they touch.
CANNED = {
    'pending-thumbs': (
        "Photos present but never thumbnailed, or thumbnailed before their own mtime",
        "SELECT COUNT(*) AS pending FROM photos "
        "WHERE present=1 AND (thumb_long_edge=0 OR thumb_mtime < mtime)",
    ),
    'pending-faces': (
        "Photos present but never face-scanned",
        "SELECT COUNT(*) AS pending FROM photos WHERE present=1 AND faces_scanned_at IS NULL",
    ),
    'face-scan-failures': (
        "Photos with a nonzero face_scan_fail_count, worst first",
        "SELECT id, rel_path, face_scan_fail_count FROM photos "
        "WHERE face_scan_fail_count > 0 ORDER BY face_scan_fail_count DESC LIMIT 20",
    ),
    'hq-offline-queue': (
        "Rows in the offline-HQ-render queue (reason + copy-vs-decode split)",
        "SELECT reason, is_copy, COUNT(*) AS n FROM hq_offline GROUP BY reason, is_copy",
    ),
    'recent-added': (
        "Most recently added photos (by catalog 'added' timestamp)",
        "SELECT id, rel_path, datetime(added, 'unixepoch') AS added_at "
        "FROM photos ORDER BY added DESC LIMIT 20",
    ),
    'photo-counts': (
        "Present/absent photo counts per volume",
        "SELECT v.label, p.present, COUNT(*) AS n FROM photos p "
        "JOIN volumes v ON v.id = p.volume_id GROUP BY v.label, p.present",
    ),
}
