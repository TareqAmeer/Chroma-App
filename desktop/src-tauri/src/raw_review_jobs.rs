//! Durable, per-source journal for display-only RAW review preparation.
//! This deliberately does not share recipe_batch's sidecar-edit/undo semantics.
use crate::catalog::CatalogState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_ITEMS: usize = 50000;
const MAX_PATH_BYTES: usize = 32768;
const MAX_RECIPE_BYTES: usize = 1024;
const MAX_SETTINGS_BYTES: usize = 4096;
const MAX_TOTAL_SETTINGS_BYTES: usize = 16 * 1024 * 1024;
const MAX_ERROR_BYTES: usize = 2048;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputItem {
    path: String,
    recipe_key: String,
    settings_json: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedRecipeKey {
    index: i64,
    recipe_key: String,
}
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: i64,
    pub label: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub items: Vec<Item>,
}
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub index: i64,
    pub path: String,
    pub recipe_key: String,
    pub settings_json: String,
    pub source_mtime_ns: String,
    pub source_size: u64,
    pub status: String,
    pub error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: i64,
    pub label: String,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub total: i64,
    pub completed: i64,
    pub pending: i64,
    pub failed: i64,
    pub failed_items: Vec<String>,
}

static SESSION_ID: OnceLock<String> = OnceLock::new();
fn session_id() -> &'static str {
    SESSION_ID.get_or_init(|| {
        format!(
            "{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        )
    })
}
fn schema(c: &Connection) -> Result<(), String> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS raw_review_jobs(
      id INTEGER PRIMARY KEY,label TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,session_id TEXT NOT NULL
    ); CREATE TABLE IF NOT EXISTS raw_review_job_items(
      job_id INTEGER NOT NULL,item_index INTEGER NOT NULL,path TEXT NOT NULL,recipe_key TEXT NOT NULL,settings_json TEXT NOT NULL,
      source_mtime_ns TEXT NOT NULL,source_size INTEGER NOT NULL,status TEXT NOT NULL,error TEXT,
      PRIMARY KEY(job_id,item_index),FOREIGN KEY(job_id) REFERENCES raw_review_jobs(id) ON DELETE CASCADE
    ); CREATE INDEX IF NOT EXISTS raw_review_job_items_status ON raw_review_job_items(job_id,status);").map_err(|e| e.to_string())
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .min(i64::MAX as u64) as i64
}
fn source_identity(path: &str) -> Result<(String, u64), String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("Cannot stat source: {e}"))?;
    if !meta.is_file() {
        return Err("Source is not a file".into());
    }
    let ns = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    Ok((ns.to_string(), meta.len()))
}
fn cache_exists(item: &Item) -> bool {
    crate::library::get_display_decode_cache_path(item.path.clone(), item.recipe_key.clone(), 2560)
        .is_ok()
}
fn validate_completion(item: &Item) -> Result<(), String> {
    let (mtime, size) = source_identity(&item.path)?;
    if mtime != item.source_mtime_ns || size != item.source_size {
        return Err("Source changed during RAW review preparation".into());
    }
    if !cache_exists(item) {
        return Err("Developed review proxy is missing; item cannot be marked complete".into());
    }
    Ok(())
}
fn validate_settings_json(text: &str) -> Result<(), String> {
    if text.len() > MAX_SETTINGS_BYTES {
        return Err("RAW review settings exceed the size limit".into());
    }
    let value: serde_json::Value = serde_json::from_str(text)
        .map_err(|_| "RAW review settings must be valid JSON".to_string())?;
    if !value.is_object() {
        return Err("RAW review settings must be a JSON object".into());
    }
    Ok(())
}
fn get(c: &Connection, id: i64) -> Result<Job, String> {
    schema(c)?;
    let (label, status, created_at, updated_at) = c
        .query_row(
            "SELECT label,status,created_at,updated_at FROM raw_review_jobs WHERE id=?",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| e.to_string())?;
    let mut stmt=c.prepare("SELECT item_index,path,recipe_key,settings_json,source_mtime_ns,source_size,status,error FROM raw_review_job_items WHERE job_id=? ORDER BY item_index").map_err(|e|e.to_string())?;
    let items = stmt
        .query_map([id], |r| {
            Ok(Item {
                index: r.get(0)?,
                path: r.get(1)?,
                recipe_key: r.get(2)?,
                settings_json: r.get(3)?,
                source_mtime_ns: r.get(4)?,
                source_size: r.get(5)?,
                status: r.get(6)?,
                error: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(Job {
        id,
        label,
        status,
        created_at,
        updated_at,
        items,
    })
}
fn get_item(c: &Connection, id: i64, index: i64) -> Result<Item, String> {
    c.query_row("SELECT item_index,path,recipe_key,settings_json,source_mtime_ns,source_size,status,error FROM raw_review_job_items WHERE job_id=? AND item_index=?",params![id,index],|r|Ok(Item{index:r.get(0)?,path:r.get(1)?,recipe_key:r.get(2)?,settings_json:r.get(3)?,source_mtime_ns:r.get(4)?,source_size:r.get(5)?,status:r.get(6)?,error:r.get(7)?})).map_err(|e|e.to_string())
}
fn ensure_persistent(c: &Connection) -> Result<(), String> {
    let db_path: String = c
        .query_row(
            "SELECT file FROM pragma_database_list WHERE name='main'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if db_path.is_empty() {
        Err("RAW review job recovery requires a persistent catalog".into())
    } else {
        Ok(())
    }
}
fn prepare_inputs(
    label: String,
    inputs: Vec<InputItem>,
) -> Result<(String, Vec<(InputItem, String, u64)>), String> {
    if inputs.is_empty() || inputs.len() > MAX_ITEMS {
        return Err(format!("Select between 1 and {MAX_ITEMS} RAWs"));
    }
    if label.len() > 240 {
        return Err("RAW review job label exceeds the size limit".into());
    }
    let mut seen = HashSet::new();
    let mut settings_bytes = 0usize;
    let mut prepared = Vec::with_capacity(inputs.len());
    for input in inputs {
        if input.path.is_empty() || input.path.len() > MAX_PATH_BYTES || input.path.contains('\0') {
            return Err("Invalid RAW source path".into());
        }
        if input.recipe_key.is_empty() || input.recipe_key.len() > MAX_RECIPE_BYTES {
            return Err("Invalid RAW review recipe key".into());
        }
        if !seen.insert(input.path.clone()) {
            return Err("RAW review jobs cannot contain the same source path twice".into());
        }
        validate_settings_json(&input.settings_json)?;
        settings_bytes = settings_bytes.saturating_add(input.settings_json.len());
        if settings_bytes > MAX_TOTAL_SETTINGS_BYTES {
            return Err("RAW review job settings exceed the total size limit".into());
        }
        let (mtime_ns, size) = source_identity(&input.path)?;
        prepared.push((input, mtime_ns, size));
    }
    Ok((label, prepared))
}
fn create_prepared(
    c: &mut Connection,
    label: String,
    prepared: Vec<(InputItem, String, u64)>,
) -> Result<Job, String> {
    schema(c)?;
    ensure_persistent(c)?;
    let timestamp = now();
    let tx = c.transaction().map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO raw_review_jobs(label,status,created_at,updated_at,session_id) VALUES (?,'running',?,?,?)",params![label,timestamp,timestamp,session_id()]).map_err(|e|e.to_string())?;
    let id = tx.last_insert_rowid();
    for (index, (input, mtime_ns, size)) in prepared.into_iter().enumerate() {
        tx.execute("INSERT INTO raw_review_job_items(job_id,item_index,path,recipe_key,settings_json,source_mtime_ns,source_size,status,error) VALUES (?,?,?,?,?,?,?,'pending',NULL)",params![id,index as i64,input.path,input.recipe_key,input.settings_json,mtime_ns,size as i64]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    get(c, id)
}
fn create(c: &mut Connection, label: String, inputs: Vec<InputItem>) -> Result<Job, String> {
    let (label, prepared) = prepare_inputs(label, inputs)?;
    create_prepared(c, label, prepared)
}
fn mark_interrupted(c: &Connection) -> Result<(), String> {
    schema(c)?;
    let ids = {
        let mut stmt = c
            .prepare("SELECT id FROM raw_review_jobs WHERE status='running' AND session_id!=?")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([session_id()], |r| r.get::<_, i64>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    let tx = c.unchecked_transaction().map_err(|e| e.to_string())?;
    for id in ids {
        tx.execute("UPDATE raw_review_jobs SET status='interrupted',updated_at=? WHERE id=? AND status='running' AND session_id!=?",params![now(),id,session_id()]).map_err(|e|e.to_string())?;
        tx.execute("UPDATE raw_review_job_items SET status='pending',error=NULL WHERE job_id=? AND status='working'",[id]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}
fn list(c: &Connection) -> Result<Vec<Summary>, String> {
    mark_interrupted(c)?;
    let mut s=c.prepare("SELECT j.id,j.label,j.status,j.created_at,j.updated_at,COUNT(i.item_index),SUM(i.status='completed'),SUM(i.status='pending' OR i.status='working'),SUM(i.status='failed') FROM raw_review_jobs j JOIN raw_review_job_items i ON i.job_id=j.id GROUP BY j.id ORDER BY j.id DESC LIMIT 100").map_err(|e|e.to_string())?;
    let mut rows = s
        .query_map([], |r| {
            Ok(Summary {
                id: r.get(0)?,
                label: r.get(1)?,
                status: r.get(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
                total: r.get(5)?,
                completed: r.get(6)?,
                pending: r.get(7)?,
                failed: r.get(8)?,
                failed_items: Vec::new(),
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(s);
    let mut failures = c
        .prepare("SELECT path,error FROM raw_review_job_items WHERE job_id=? AND status='failed' ORDER BY item_index LIMIT 20")
        .map_err(|e| e.to_string())?;
    for row in &mut rows {
        row.failed_items = failures
            .query_map([row.id], |r| {
                let path: String = r.get(0)?;
                let error: Option<String> = r.get(1)?;
                let detail = error.unwrap_or_else(|| "failed".to_string());
                Ok(format!("{}: {}", path, detail))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|s| s.chars().take(240).collect())
            .collect();
    }
    Ok(rows)
}
fn checkpoint_input(c: &Connection, id: i64, index: i64) -> Result<(String, Item), String> {
    let status: String = c
        .query_row("SELECT status FROM raw_review_jobs WHERE id=?", [id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    let item = get_item(c, id, index)?;
    Ok((status, item))
}
fn checkpoint_commit(
    c: &Connection,
    id: i64,
    index: i64,
    status: &str,
    error: Option<&str>,
) -> Result<Item, String> {
    if !["working", "completed", "failed"].contains(&status) {
        return Err("Invalid RAW review checkpoint".into());
    }
    let tx = c.unchecked_transaction().map_err(|e| e.to_string())?;
    let changed=tx.execute("UPDATE raw_review_job_items SET status=?,error=? WHERE job_id=? AND item_index=? AND (?='completed' OR status!='completed') AND EXISTS(SELECT 1 FROM raw_review_jobs WHERE id=? AND status='running')",params![status,error.map(|e|e.chars().take(MAX_ERROR_BYTES).collect::<String>()),id,index,status,id]).map_err(|e|e.to_string())?;
    if changed == 0 {
        return Err("RAW review job is no longer running".into());
    }
    tx.execute(
        "UPDATE raw_review_jobs SET updated_at=? WHERE id=?",
        params![now(), id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    get_item(c, id, index)
}
fn finish(c: &Connection, id: i64) -> Result<Job, String> {
    let tx = c.unchecked_transaction().map_err(|e| e.to_string())?;
    let status: String = tx
        .query_row("SELECT status FROM raw_review_jobs WHERE id=?", [id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    if status != "running" {
        return Err("RAW review job is not running".into());
    }
    let (pending,failed):(i64,i64)=tx.query_row("SELECT SUM(status IN ('pending','working')),SUM(status='failed') FROM raw_review_job_items WHERE job_id=?",[id],|r|Ok((r.get::<_,Option<i64>>(0)?.unwrap_or(0),r.get::<_,Option<i64>>(1)?.unwrap_or(0)))).map_err(|e|e.to_string())?;
    if pending > 0 {
        return Err("RAW review job still has unfinished items".into());
    }
    let terminal = if failed > 0 { "partial" } else { "completed" };
    tx.execute(
        "UPDATE raw_review_jobs SET status=?,updated_at=? WHERE id=?",
        params![terminal, now(), id],
    )
    .map_err(|e| e.to_string())?;
    if terminal == "completed" {
        tx.execute("DELETE FROM raw_review_job_items WHERE job_id IN (SELECT id FROM raw_review_jobs WHERE status='completed' ORDER BY updated_at DESC,id DESC LIMIT -1 OFFSET 100)",[]).map_err(|e|e.to_string())?;
        tx.execute("DELETE FROM raw_review_jobs WHERE status='completed' AND id NOT IN (SELECT id FROM raw_review_jobs WHERE status='completed' ORDER BY updated_at DESC,id DESC LIMIT 100)",[]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    get(c, id)
}
fn resume_plan(mut job: Job, expected: &[(i64, String)]) -> Result<(String, Vec<Item>), String> {
    if job.status == "running" {
        return Err("RAW review job is already running".into());
    }
    let expected: std::collections::HashMap<_, _> =
        expected.iter().map(|(i, k)| (*i, k.as_str())).collect();
    let prior = job.status.clone();
    let mut items = std::mem::take(&mut job.items);
    // Filesystem stats and cache probes are intentionally performed without holding CatalogState.conn.
    for item in &mut items {
        let source_ok = source_identity(&item.path)
            .map(|(mtime, size)| mtime == item.source_mtime_ns && size == item.source_size)
            .unwrap_or(false);
        let recipe_ok = expected
            .get(&item.index)
            .is_none_or(|key| *key == item.recipe_key);
        if !source_ok {
            item.status = "failed".into();
            item.error = Some("Source changed or is offline; prepare this RAW again".into());
        } else if !recipe_ok {
            item.status = "failed".into();
            item.error = Some("RAW review settings changed; prepare this RAW again".into());
        } else if cache_exists(item) {
            item.status = "completed".into();
            item.error = None;
        } else {
            item.status = "pending".into();
            item.error = None;
        }
    }
    Ok((prior, items))
}
fn resume_commit(
    c: &mut Connection,
    id: i64,
    prior_status: &str,
    items: &[Item],
) -> Result<Job, String> {
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let changed = tx.execute(
        "UPDATE raw_review_jobs SET status='running',updated_at=?,session_id=? WHERE id=? AND status=? AND status!='running'",
        params![now(), session_id(), id, prior_status],
    ).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("RAW review job changed while resuming; reload its status".into());
    }
    for item in items {
        tx.execute(
            "UPDATE raw_review_job_items SET status=?,error=? WHERE job_id=? AND item_index=?",
            params![item.status, item.error, id, item.index],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    get(c, id)
}
fn cancel(c: &Connection, id: i64) -> Result<Job, String> {
    let tx = c.unchecked_transaction().map_err(|e| e.to_string())?;
    let changed=tx.execute("UPDATE raw_review_jobs SET status='cancelled',updated_at=? WHERE id=? AND status IN ('running','interrupted')",params![now(),id]).map_err(|e|e.to_string())?;
    if changed == 0 {
        return Err("RAW review job cannot be cancelled in its current state".into());
    }
    tx.execute("UPDATE raw_review_job_items SET status='cancelled' WHERE job_id=? AND status IN ('pending','working')",[id]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    get(c, id)
}
fn interrupt(c: &Connection, id: i64) -> Result<Job, String> {
    let tx = c.unchecked_transaction().map_err(|e| e.to_string())?;
    let changed=tx.execute("UPDATE raw_review_jobs SET status='interrupted',updated_at=? WHERE id=? AND status='running'",params![now(),id]).map_err(|e|e.to_string())?;
    if changed == 0 {
        return Err("RAW review job is not running".into());
    }
    tx.execute("UPDATE raw_review_job_items SET status='pending',error=NULL WHERE job_id=? AND status='working'",[id]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    get(c, id)
}

#[tauri::command(async)]
pub fn raw_review_jobs_create(
    label: String,
    items: Vec<InputItem>,
    state: tauri::State<CatalogState>,
) -> Result<Job, String> {
    {
        let c = state.conn.lock().map_err(|e| e.to_string())?;
        mark_interrupted(&c)?;
    }
    let (label, prepared) = prepare_inputs(label, items)?;
    let mut c = state.conn.lock().map_err(|e| e.to_string())?;
    create_prepared(&mut c, label, prepared)
}
#[tauri::command(async)]
pub fn raw_review_jobs_list(state: tauri::State<CatalogState>) -> Result<Vec<Summary>, String> {
    list(&*state.conn.lock().map_err(|e| e.to_string())?)
}
#[tauri::command(async)]
pub fn raw_review_jobs_get(id: i64, state: tauri::State<CatalogState>) -> Result<Job, String> {
    let c = state.conn.lock().map_err(|e| e.to_string())?;
    mark_interrupted(&c)?;
    get(&c, id)
}
#[tauri::command(async)]
pub fn raw_review_jobs_checkpoint(
    id: i64,
    index: i64,
    status: String,
    error: Option<String>,
    state: tauri::State<CatalogState>,
) -> Result<Item, String> {
    {
        let c = state.conn.lock().map_err(|e| e.to_string())?;
        mark_interrupted(&c)?;
    }
    if status == "completed" {
        let (job_status, item) = {
            let c = state.conn.lock().map_err(|e| e.to_string())?;
            checkpoint_input(&c, id, index)?
        };
        if job_status != "running" {
            return Err("RAW review job is no longer running".into());
        }
        validate_completion(&item)?;
    }
    checkpoint_commit(
        &*state.conn.lock().map_err(|e| e.to_string())?,
        id,
        index,
        &status,
        error.as_deref(),
    )
}
#[tauri::command(async)]
pub fn raw_review_jobs_cancel(id: i64, state: tauri::State<CatalogState>) -> Result<Job, String> {
    let c = state.conn.lock().map_err(|e| e.to_string())?;
    mark_interrupted(&c)?;
    cancel(&c, id)
}
#[tauri::command(async)]
pub fn raw_review_jobs_interrupt(
    id: i64,
    state: tauri::State<CatalogState>,
) -> Result<Job, String> {
    let c = state.conn.lock().map_err(|e| e.to_string())?;
    mark_interrupted(&c)?;
    interrupt(&c, id)
}
#[tauri::command(async)]
pub fn raw_review_jobs_resume(
    id: i64,
    expected_recipe_keys: Option<Vec<ExpectedRecipeKey>>,
    state: tauri::State<CatalogState>,
) -> Result<Job, String> {
    let (job, expected) = {
        let c = state.conn.lock().map_err(|e| e.to_string())?;
        mark_interrupted(&c)?;
        let expected = expected_recipe_keys
            .unwrap_or_default()
            .into_iter()
            .map(|e| (e.index, e.recipe_key))
            .collect::<Vec<_>>();
        (get(&c, id)?, expected)
    };
    if expected.len() > MAX_ITEMS
        || expected
            .iter()
            .any(|(i, k)| *i < 0 || k.is_empty() || k.len() > MAX_RECIPE_BYTES)
    {
        return Err("Invalid expected RAW review recipe keys".into());
    }
    let (prior, items) = resume_plan(job, &expected)?;
    resume_commit(
        &mut *state.conn.lock().map_err(|e| e.to_string())?,
        id,
        &prior,
        &items,
    )
}
#[tauri::command(async)]
pub fn raw_review_jobs_finish(id: i64, state: tauri::State<CatalogState>) -> Result<Job, String> {
    let c = state.conn.lock().map_err(|e| e.to_string())?;
    mark_interrupted(&c)?;
    finish(&c, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    fn test_dir(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "raw-review-jobs-{}-{}-{tag}",
            std::process::id(),
            now()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }
    fn item(path: &str, key: &str) -> InputItem {
        InputItem {
            path: path.into(),
            recipe_key: key.into(),
            settings_json: "{\"rawNr\":\"fast\",\"profile\":\"Adobe Color\"}".into(),
        }
    }
    fn write_proxy(path: &str, key: &str) {
        crate::library::write_decode_cache_rgba(path.into(), key.into(), 1, 1, &[20, 30, 40, 255])
            .unwrap();
        crate::library::get_display_decode_cache(path.into(), key.into(), 2560).unwrap();
    }
    #[test]
    fn restart_resume_keeps_only_exact_existing_proxies_and_retries_other_items() {
        let _cache = crate::library::isolate_cache_dir("raw_review_restart");
        let dir = test_dir("restart");
        let a = dir.join("a.RW2");
        let b = dir.join("b.RW2");
        std::fs::write(&a, b"a").unwrap();
        std::fs::write(&b, b"b").unwrap();
        let (a, b) = (
            a.to_string_lossy().into_owned(),
            b.to_string_lossy().into_owned(),
        );
        let db = dir.join("catalog.db");
        let mut c = Connection::open(&db).unwrap();
        let job = create(
            &mut c,
            "Prepare RAWs".into(),
            vec![item(&a, "recipe-a"), item(&b, "recipe-b")],
        )
        .unwrap();
        assert_ne!(job.items[0].recipe_key, job.items[1].recipe_key);
        write_proxy(&a, "recipe-a");
        checkpoint_commit(&c, job.id, 0, "working", None).unwrap();
        assert!(checkpoint(&c, job.id, 0, "completed", None));
        checkpoint_commit(&c, job.id, 1, "working", None).unwrap();
        drop(c);
        let mut c = Connection::open(&db).unwrap();
        c.execute(
            "UPDATE raw_review_jobs SET session_id='prior-process' WHERE id=?",
            [job.id],
        )
        .unwrap();
        let recovered = list(&c).unwrap();
        assert_eq!(recovered[0].status, "interrupted");
        assert_eq!(get(&c, job.id).unwrap().items[1].status, "pending");
        let (prior, plan) = resume_plan(
            get(&c, job.id).unwrap(),
            &[(0, "recipe-a".into()), (1, "recipe-b".into())],
        )
        .unwrap();
        let resumed = resume_commit(&mut c, job.id, &prior, &plan).unwrap();
        assert_eq!(resumed.items[0].status, "completed");
        assert_eq!(resumed.items[1].status, "pending");
        assert!(
            resume_commit(&mut c, job.id, &prior, &plan).is_err(),
            "a stale concurrent resume plan must fail its status compare-and-swap"
        );
        cancel(&c, job.id).unwrap();
        let proxy =
            crate::library::get_display_decode_cache_path(a.clone(), "recipe-a".into(), 2560)
                .unwrap();
        std::fs::remove_file(proxy).unwrap();
        let (prior, plan) = resume_plan(
            get(&c, job.id).unwrap(),
            &[(0, "recipe-a".into()), (1, "recipe-b".into())],
        )
        .unwrap();
        let resumed = resume_commit(&mut c, job.id, &prior, &plan).unwrap();
        assert_eq!(
            resumed.items[0].status, "pending",
            "evicted successes must be re-prepared"
        );
        assert_eq!(resumed.items[1].status, "pending");
        drop(c);
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn resume_fails_source_or_recipe_changes_and_retries_failed_item() {
        let _cache = crate::library::isolate_cache_dir("raw_review_retry");
        let dir = test_dir("retry");
        let path = dir.join("one.RW2");
        std::fs::write(&path, b"original").unwrap();
        let path = path.to_string_lossy().into_owned();
        let mut c = Connection::open(dir.join("catalog.db")).unwrap();
        let job = create(&mut c, "Prepare".into(), vec![item(&path, "old-key")]).unwrap();
        checkpoint_commit(&c, job.id, 0, "failed", Some("test failure")).unwrap();
        finish(&c, job.id).unwrap();
        let (prior, plan) =
            resume_plan(get(&c, job.id).unwrap(), &[(0, "old-key".into())]).unwrap();
        let resumed = resume_commit(&mut c, job.id, &prior, &plan).unwrap();
        assert_eq!(resumed.items[0].status, "pending");
        checkpoint_commit(&c, job.id, 0, "failed", Some("again")).unwrap();
        finish(&c, job.id).unwrap();
        let (prior, plan) =
            resume_plan(get(&c, job.id).unwrap(), &[(0, "new-key".into())]).unwrap();
        let resumed = resume_commit(&mut c, job.id, &prior, &plan).unwrap();
        assert_eq!(resumed.items[0].status, "failed");
        assert!(resumed.items[0]
            .error
            .as_deref()
            .unwrap()
            .contains("settings changed"));
        finish(&c, job.id).unwrap();
        let (prior, plan) =
            resume_plan(get(&c, job.id).unwrap(), &[(0, "old-key".into())]).unwrap();
        resume_commit(&mut c, job.id, &prior, &plan).unwrap();
        std::fs::write(&path, b"changed source size").unwrap();
        cancel(&c, job.id).unwrap();
        let (prior, plan) =
            resume_plan(get(&c, job.id).unwrap(), &[(0, "old-key".into())]).unwrap();
        let resumed = resume_commit(&mut c, job.id, &prior, &plan).unwrap();
        assert_eq!(resumed.items[0].status, "failed");
        assert!(resumed.items[0]
            .error
            .as_deref()
            .unwrap()
            .contains("Source changed"));
        drop(c);
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn same_session_interrupt_and_cancel_preserve_verified_completion() {
        let _cache = crate::library::isolate_cache_dir("raw_review_interrupt_cancel");
        let dir = test_dir("interrupt-cancel");
        let a = dir.join("a.RW2");
        let b = dir.join("b.RW2");
        std::fs::write(&a, b"a").unwrap();
        std::fs::write(&b, b"b").unwrap();
        let a = a.to_string_lossy().into_owned();
        let b = b.to_string_lossy().into_owned();
        let mut c = Connection::open(dir.join("catalog.db")).unwrap();
        let job = create(
            &mut c,
            "Prepare".into(),
            vec![item(&a, "a-key"), item(&b, "b-key")],
        )
        .unwrap();
        write_proxy(&a, "a-key");
        checkpoint_commit(&c, job.id, 0, "working", None).unwrap();
        let a_item = get(&c, job.id).unwrap().items.remove(0);
        validate_completion(&a_item).unwrap();
        checkpoint_commit(&c, job.id, 0, "completed", None).unwrap();
        checkpoint_commit(&c, job.id, 1, "working", None).unwrap();

        let interrupted = interrupt(&c, job.id).unwrap();
        assert_eq!(interrupted.status, "interrupted");
        assert_eq!(interrupted.items[0].status, "completed");
        assert_eq!(interrupted.items[1].status, "pending");
        let cancelled = cancel(&c, job.id).unwrap();
        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(cancelled.items[0].status, "completed");
        assert_eq!(cancelled.items[1].status, "cancelled");

        let (prior, plan) = resume_plan(
            get(&c, job.id).unwrap(),
            &[(0, "a-key".into()), (1, "b-key".into())],
        )
        .unwrap();
        let resumed = resume_commit(&mut c, job.id, &prior, &plan).unwrap();
        assert_eq!(
            resumed.items[0].status, "completed",
            "cancel/resume skips the exact verified proxy"
        );
        assert_eq!(resumed.items[1].status, "pending");

        write_proxy(&b, "b-key");
        let b_item = resumed.items[1].clone();
        std::fs::write(&b, b"b changed after decode").unwrap();
        assert!(validate_completion(&b_item)
            .unwrap_err()
            .contains("Source changed"));
        drop(c);
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn first_create_reaps_prior_session_jobs_before_adding_new_job() {
        let dir = test_dir("first-create-recovery");
        let photo = dir.join("one.RW2");
        std::fs::write(&photo, b"one").unwrap();
        let photo = photo.to_string_lossy().into_owned();
        let mut c = Connection::open(dir.join("catalog.db")).unwrap();
        let old = create(&mut c, "Old session".into(), vec![item(&photo, "old-key")]).unwrap();
        c.execute(
            "UPDATE raw_review_jobs SET session_id='previous-session' WHERE id=?",
            [old.id],
        )
        .unwrap();
        mark_interrupted(&c).unwrap();
        let fresh = create(
            &mut c,
            "New selection".into(),
            vec![item(&photo, "new-key")],
        )
        .unwrap();
        assert_eq!(get(&c, old.id).unwrap().status, "interrupted");
        assert_eq!(get(&c, fresh.id).unwrap().status, "running");
        drop(c);
        let _ = std::fs::remove_dir_all(dir);
    }
    fn checkpoint(c: &Connection, id: i64, index: i64, status: &str, error: Option<&str>) -> bool {
        if status == "completed" {
            let (_, item) = checkpoint_input(c, id, index).unwrap();
            if validate_completion(&item).is_err() {
                return false;
            }
        }
        checkpoint_commit(c, id, index, status, error).is_ok()
    }
}
