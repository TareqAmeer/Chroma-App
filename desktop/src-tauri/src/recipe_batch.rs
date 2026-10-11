//! Durable recipe batches. Sidecar completion is recorded after its write; replay is idempotent.
use crate::catalog::CatalogState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub path: String,
    pub recipe: String,
    pub expected_recipe: Option<String>,
    pub expected_active: Option<usize>,
    pub error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub id: i64,
    pub label: String,
    pub status: String,
    pub created_at: i64,
    pub items: Vec<Item>,
}
#[derive(Serialize)]
pub struct Item {
    pub index: i64,
    pub path: String,
    pub recipe: String,
    pub status: String,
    pub error: Option<String>,
}
fn schema(c: &Connection) -> Result<(), String> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS recipe_batches(id INTEGER PRIMARY KEY,label TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS recipe_batch_items(batch_id INTEGER NOT NULL,item_index INTEGER NOT NULL,path TEXT NOT NULL,recipe TEXT NOT NULL,original TEXT NOT NULL,original_edited INTEGER NOT NULL,active INTEGER NOT NULL,status TEXT NOT NULL,error TEXT,version_name TEXT NOT NULL,PRIMARY KEY(batch_id,item_index)); CREATE INDEX IF NOT EXISTS recipe_batch_pending ON recipe_batch_items(batch_id,status);").map_err(|e|e.to_string())
}
fn get(c: &Connection, id: i64) -> Result<Batch, String> {
    schema(c)?;
    let (label, status, created_at) = c
        .query_row(
            "SELECT label,status,created_at FROM recipe_batches WHERE id=?",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    let mut s=c.prepare("SELECT item_index,path,recipe,status,error FROM recipe_batch_items WHERE batch_id=? ORDER BY item_index").map_err(|e|e.to_string())?;
    let items = s
        .query_map([id], |r| {
            Ok(Item {
                index: r.get(0)?,
                path: r.get(1)?,
                recipe: r.get(2)?,
                status: r.get(3)?,
                error: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(Batch {
        id,
        label,
        status,
        created_at,
        items,
    })
}
fn create(c: &mut Connection, label: String, items: Vec<Input>) -> Result<Batch, String> {
    schema(c)?;
    let db_path: String = c
        .query_row(
            "SELECT file FROM pragma_database_list WHERE name='main'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if db_path.is_empty() {
        return Err("Batch editing requires a persistent catalog for recovery".into());
    }
    if items.is_empty() {
        return Err("No photos selected".into());
    }
    let tx = c.transaction().map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO recipe_batches(label,status,created_at) VALUES (?,'running',strftime('%s','now'))",[label]).map_err(|e|e.to_string())?;
    let id = tx.last_insert_rowid();
    for (index, item) in items.into_iter().enumerate() {
        let read = checked_sidecar(&item.path);
        let mut error = item.error.map(|e| format!("Preflight: {e}"));
        if let Err(e) = &read {
            error = Some(format!("Preflight: {e}"));
        }
        let sc = read.unwrap_or_default();
        if item
            .expected_recipe
            .as_ref()
            .is_some_and(|r| r != &sc.recipe)
            || item.expected_active.is_some_and(|a| a != sc.active)
        {
            error = Some("Preflight: Photo changed while preparing this batch".into());
        }
        let status = if error.is_some() {
            "failed"
        } else if item.recipe == sc.recipe {
            error = Some("Recipe already matches".into());
            "skipped"
        } else {
            "pending"
        };
        tx.execute(
            "INSERT INTO recipe_batch_items VALUES (?,?,?,?,?,?,?,?,?,?)",
            params![
                id,
                index as i64,
                item.path,
                item.recipe,
                sc.recipe.clone(),
                sc.edited,
                sc.active as i64,
                status,
                error,
                sc.versions
                    .get(sc.active)
                    .map(|v| v.name.clone())
                    .unwrap_or_default()
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute("UPDATE recipe_batches SET status='completed' WHERE id=? AND NOT EXISTS(SELECT 1 FROM recipe_batch_items WHERE batch_id=? AND status='pending')",params![id,id]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    get(c, id)
}
fn item(c: &Connection, id: i64, index: i64) -> Result<Item, String> {
    c.query_row("SELECT item_index,path,recipe,status,error FROM recipe_batch_items WHERE batch_id=? AND item_index=?",params![id,index],|r|Ok(Item{index:r.get(0)?,path:r.get(1)?,recipe:r.get(2)?,status:r.get(3)?,error:r.get(4)?})).map_err(|e|e.to_string())
}
fn checked_sidecar(path: &str) -> Result<crate::library::Sidecar, String> {
    let p = crate::canon::sidecar_path_for(std::path::Path::new(path));
    match std::fs::read_to_string(p) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Cannot read sidecar: {e}")),
    };
    Ok(crate::library::get_sidecar(path.to_string()))
}
fn apply(c: &Connection, id: i64, index: i64) -> Result<Item, String> {
    let batch_status: String = c
        .query_row("SELECT status FROM recipe_batches WHERE id=?", [id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    if batch_status != "running" {
        return item(c, id, index);
    }
    let (path,target,original,active,status,version_name):(String,String,String,i64,String,String)=c.query_row("SELECT path,recipe,original,active,status,version_name FROM recipe_batch_items WHERE batch_id=? AND item_index=?",params![id,index],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).map_err(|e|e.to_string())?;
    if status != "pending" {
        return item(c, id, index);
    }
    let result = (|| {
        if !std::path::Path::new(&path).is_file() {
            return Err("Photo is offline or missing".into());
        }
        let sc = checked_sidecar(&path)?;
        if sc.active as i64 != active
            || sc
                .versions
                .get(sc.active)
                .map(|v| v.name.as_str())
                .unwrap_or("")
                != version_name
            || (sc.recipe != original && sc.recipe != target)
        {
            return Err("Photo edits changed since this batch was created".into());
        }
        crate::library::set_recipe_batch_run(path, true, target, c)
    })();
    let (status, error) = match result {
        Ok(()) => ("applied", None),
        Err(e) => ("failed", Some(e)),
    };
    c.execute(
        "UPDATE recipe_batch_items SET status=?,error=? WHERE batch_id=? AND item_index=?",
        params![status, error, id, index],
    )
    .map_err(|e| e.to_string())?;
    let pending: i64 = c
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM recipe_batch_items WHERE batch_id=? AND status='pending')",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if pending == 0 {
        sync_registry(c, id)?;
        c.execute(
            "UPDATE recipe_batches SET status='completed' WHERE id=?",
            [id],
        )
        .map_err(|e| e.to_string())?;
    }
    item(c, id, index)
}
#[tauri::command(async)]
pub fn recipe_batch_create(
    label: String,
    items: Vec<Input>,
    state: tauri::State<CatalogState>,
) -> Result<Batch, String> {
    create(
        &mut *state.conn.lock().map_err(|e| e.to_string())?,
        label,
        items,
    )
}
#[tauri::command(async)]
pub fn recipe_batch_get(id: i64, state: tauri::State<CatalogState>) -> Result<Batch, String> {
    get(&*state.conn.lock().map_err(|e| e.to_string())?, id)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    id: i64,
    label: String,
    status: String,
    created_at: i64,
    total: i64,
    pending: i64,
    failed: i64,
    conflict: i64,
}
#[tauri::command(async)]
pub fn recipe_batch_list(state: tauri::State<CatalogState>) -> Result<Vec<Summary>, String> {
    let c = state.conn.lock().map_err(|e| e.to_string())?;
    schema(&c)?;
    let mut s=c.prepare("SELECT b.id,b.label,b.status,b.created_at,COUNT(i.item_index),SUM(i.status='pending'),SUM(i.status='failed'),SUM(i.status='conflict') FROM recipe_batches b JOIN recipe_batch_items i ON i.batch_id=b.id WHERE b.status IN ('running','cancelled','undoing') OR b.id IN (SELECT id FROM recipe_batches ORDER BY id DESC LIMIT 30) GROUP BY b.id ORDER BY b.id DESC").map_err(|e|e.to_string())?;
    let result = s
        .query_map([], |r| {
            Ok(Summary {
                id: r.get(0)?,
                label: r.get(1)?,
                status: r.get(2)?,
                created_at: r.get(3)?,
                total: r.get(4)?,
                pending: r.get(5)?,
                failed: r.get(6)?,
                conflict: r.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
    result
}
#[tauri::command(async)]
pub fn recipe_batch_apply_item(
    id: i64,
    index: i64,
    state: tauri::State<CatalogState>,
) -> Result<Item, String> {
    apply(&*state.conn.lock().map_err(|e| e.to_string())?, id, index)
}
#[tauri::command(async)]
pub fn recipe_batch_cancel(id: i64, state: tauri::State<CatalogState>) -> Result<Batch, String> {
    let c = state.conn.lock().map_err(|e| e.to_string())?;
    schema(&c)?;
    c.execute(
        "UPDATE recipe_batches SET status='cancelled' WHERE id=? AND status IN ('running','undoing')",
        [id],
    )
    .map_err(|e| e.to_string())?;
    sync_registry(&c, id)?;
    get(&c, id)
}
#[tauri::command(async)]
pub fn recipe_batch_resume(
    id: i64,
    retry_indices: Option<Vec<i64>>,
    state: tauri::State<CatalogState>,
) -> Result<Batch, String> {
    resume(
        &mut *state.conn.lock().map_err(|e| e.to_string())?,
        id,
        retry_indices.as_deref(),
    )
}
fn resume(c: &mut Connection, id: i64, retry_indices: Option<&[i64]>) -> Result<Batch, String> {
    schema(&c)?;
    if get(&c, id)?.status == "undone" {
        return Err("An undone batch cannot be resumed".into());
    }
    let tx = c.transaction().map_err(|e| e.to_string())?;
    if let Some(indices) = retry_indices {
        for index in indices {
            tx.execute(
                "UPDATE recipe_batch_items SET status='pending',error=NULL WHERE batch_id=? AND item_index=? AND (status='skipped' OR (status='failed' AND (error IS NULL OR error NOT LIKE 'Preflight:%'))) ",
                params![id, index],
            )
            .map_err(|e| e.to_string())?;
        }
    } else {
        tx.execute("UPDATE recipe_batch_items SET status='pending',error=NULL WHERE batch_id=? AND status='failed' AND (error IS NULL OR error NOT LIKE 'Preflight:%')",[id]).map_err(|e|e.to_string())?;
    }
    tx.execute(
        "UPDATE recipe_batches SET status='running' WHERE id=? AND status!='undone'",
        [id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    sync_registry(&c, id)?;
    c.execute("UPDATE recipe_batches SET status='completed' WHERE id=? AND NOT EXISTS(SELECT 1 FROM recipe_batch_items WHERE batch_id=? AND status='pending')",params![id,id]).map_err(|e|e.to_string())?;
    get(&c, id)
}
#[tauri::command(async)]
pub fn recipe_batch_undo(id: i64, state: tauri::State<CatalogState>) -> Result<Batch, String> {
    undo(&*state.conn.lock().map_err(|e| e.to_string())?, id)
}
fn undo(c: &Connection, id: i64) -> Result<Batch, String> {
    let batch = get(c, id)?;
    if batch.status == "running" {
        return Err("Cancel the running batch before undo".into());
    }
    c.execute(
        "UPDATE recipe_batches SET status='undoing' WHERE id=?",
        [id],
    )
    .map_err(|e| e.to_string())?;
    c.execute(
        "UPDATE recipe_batch_items SET status='cancelled' WHERE batch_id=? AND status='pending'",
        [id],
    )
    .map_err(|e| e.to_string())?;
    for item in batch
        .items
        .iter()
        .filter(|i| i.status == "applied" || i.status == "conflict")
    {
        let (original,edited,active,version_name):(String,bool,i64,String)=c.query_row("SELECT original,original_edited,active,version_name FROM recipe_batch_items WHERE batch_id=? AND item_index=?",params![id,item.index],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(|e|e.to_string())?;
        let sc = match checked_sidecar(&item.path) {
            Ok(sc) => sc,
            Err(e) => {
                c.execute("UPDATE recipe_batch_items SET status='conflict',error=? WHERE batch_id=? AND item_index=?",params![e,id,item.index]).map_err(|e|e.to_string())?;
                continue;
            }
        };
        let result = if !std::path::Path::new(&item.path).is_file() {
            Err("Photo is offline or missing".into())
        } else if sc.active as i64 != active
            || sc
                .versions
                .get(sc.active)
                .map(|v| v.name.as_str())
                .unwrap_or("")
                != version_name
            || (sc.recipe != item.recipe && sc.recipe != original)
        {
            Err("Later edits preserved; undo skipped".into())
        } else {
            crate::library::set_recipe_batch_run(item.path.clone(), edited, original, c)
        };
        let (status, error) = match result {
            Ok(()) => ("undone", None),
            Err(e) => ("conflict", Some(e)),
        };
        c.execute(
            "UPDATE recipe_batch_items SET status=?,error=? WHERE batch_id=? AND item_index=?",
            params![status, error, id, item.index],
        )
        .map_err(|e| e.to_string())?;
    }
    sync_registry(c, id)?;
    c.execute("UPDATE recipe_batches SET status='undone' WHERE id=?", [id])
        .map_err(|e| e.to_string())?;
    get(c, id)
}
fn sync_registry(c: &Connection, id: i64) -> Result<(), String> {
    let b = get(c, id)?;
    let mut present = Vec::new();
    let mut absent = Vec::new();
    for i in b.items {
        if i.status == "applied" {
            present.push(i.path)
        } else if i.status == "undone" {
            if checked_sidecar(&i.path)?.edited {
                present.push(i.path)
            } else {
                absent.push(i.path)
            }
        }
    }
    crate::library::registry_set_many("edited".into(), present, absent)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn durable_failure_retry_and_cancel() {
        let dir = test_dir();
        let mut c = Connection::open(dir.join("catalog.db")).unwrap();
        let b = create(
            &mut c,
            "Paste".into(),
            vec![Input {
                path: "missing-photo-for-recipe-test.jpg".into(),
                recipe: "new".into(),
                expected_recipe: None,
                expected_active: None,
                error: None,
            }],
        )
        .unwrap();
        assert_eq!(get(&c, b.id).unwrap().items[0].status, "pending");
        let b = apply(&c, b.id, 0).unwrap();
        assert_eq!(b.status, "failed");
        assert!(b.error.as_ref().unwrap().contains("missing"));
        assert_eq!(get(&c, 1).unwrap().status, "completed");
        assert_eq!(apply(&c, 1, 0).unwrap().status, "failed");
    }
    #[test]
    fn resume_retries_only_selected_skips_and_never_preflight_or_applied_items() {
        let _cache = crate::library::isolate_cache_dir("recipe_batch_retry_skipped");
        let dir = test_dir();
        let paths = (0..4)
            .map(|index| {
                let path = dir.join(format!("photo-{index}.jpg"));
                std::fs::write(&path, b"photo").unwrap();
                path.to_string_lossy().into_owned()
            })
            .collect::<Vec<_>>();
        let mut c = Connection::open(dir.join("catalog.db")).unwrap();
        let b = create(
            &mut c,
            "Paste".into(),
            vec![
                Input { path: paths[0].clone(), recipe: String::new(), expected_recipe: None, expected_active: None, error: None },
                Input { path: paths[1].clone(), recipe: String::new(), expected_recipe: None, expected_active: None, error: None },
                Input { path: paths[2].clone(), recipe: "target".into(), expected_recipe: None, expected_active: None, error: Some("broken source".into()) },
                Input { path: paths[3].clone(), recipe: "target".into(), expected_recipe: None, expected_active: None, error: None },
            ],
        ).unwrap();
        assert_eq!(b.items.iter().map(|item| item.status.as_str()).collect::<Vec<_>>(), ["skipped", "skipped", "failed", "pending"]);
        c.execute("UPDATE recipe_batch_items SET status='applied' WHERE batch_id=? AND item_index=3", [b.id]).unwrap();

        let resumed = resume(&mut c, b.id, Some(&[0])).unwrap();
        assert_eq!(resumed.status, "running");
        assert_eq!(resumed.items.iter().map(|item| item.status.as_str()).collect::<Vec<_>>(), ["pending", "skipped", "failed", "applied"]);
        assert!(resumed.items[2].error.as_deref().unwrap().starts_with("Preflight:"));

        assert_eq!(apply(&c, b.id, 0).unwrap().status, "applied");
        let final_batch = get(&c, b.id).unwrap();
        assert_eq!(final_batch.items[1].status, "skipped", "an unselected skip must remain untouched");
        assert_eq!(final_batch.items[2].status, "failed", "preflight failures require repair before retry");
        assert_eq!(final_batch.items[3].status, "applied", "already-applied photos must not replay");
        drop(c);
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn empty_batch_is_rejected() {
        let mut c = Connection::open_in_memory().unwrap();
        assert!(create(&mut c, "Paste".into(), vec![]).is_err());
    }
    fn test_dir() -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!(
            "recipe-batch-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }
    #[test]
    fn crash_fixture_child() {
        let Ok(db_path) = std::env::var("CHR_RECIPE_BATCH_CRASH_DB") else {
            return;
        };
        let first = std::env::var("CHR_RECIPE_BATCH_CRASH_FIRST").unwrap();
        let second = std::env::var("CHR_RECIPE_BATCH_CRASH_SECOND").unwrap();
        let _cache = crate::library::isolate_cache_dir("recipe_batch_process_crash_child");
        std::fs::write(&first, b"photo").unwrap();
        std::fs::write(&second, b"photo").unwrap();
        let mut c = Connection::open(db_path).unwrap();
        c.pragma_update(None, "journal_mode", "WAL").unwrap();
        let batch = create(
            &mut c,
            "Crash recovery fixture".into(),
            [first, second]
                .into_iter()
                .map(|path| Input {
                    path,
                    recipe: "target".into(),
                    expected_recipe: None,
                    expected_active: None,
                    error: None,
                })
                .collect(),
        )
        .unwrap();
        assert_eq!(apply(&c, batch.id, 0).unwrap().status, "applied");
        // Exit without dropping the SQLite connection, matching a forced process kill after
        // one item was durably written and before the worker could finish the remaining item.
        std::process::exit(73);
    }
    #[test]
    fn process_crash_recovers_persisted_batch_and_resumes_remaining_items() {
        let _cache = crate::library::isolate_cache_dir("recipe_batch_process_crash_parent");
        let dir = test_dir();
        let db = dir.join("catalog.db");
        let first = dir.join("first.jpg");
        let second = dir.join("second.jpg");
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "recipe_batch::tests::crash_fixture_child", "--nocapture"])
            .env("CHR_RECIPE_BATCH_CRASH_DB", &db)
            .env("CHR_RECIPE_BATCH_CRASH_FIRST", &first)
            .env("CHR_RECIPE_BATCH_CRASH_SECOND", &second)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(73), "child output: {}", String::from_utf8_lossy(&output.stderr));

        let mut c = Connection::open(&db).unwrap();
        let ids = {
            let mut s = c
                .prepare("SELECT id FROM recipe_batches WHERE label='Crash recovery fixture'")
                .unwrap();
            s.query_map([], |row| row.get::<_, i64>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(
            ids.len(),
            1,
            "the batch journal must survive process termination"
        );
        let batch = get(&c, ids[0]).unwrap();
        assert_eq!(
            batch.status, "running",
            "startup must find and report the interrupted job"
        );
        assert_eq!(
            batch
                .items
                .iter()
                .map(|i| i.status.as_str())
                .collect::<Vec<_>>(),
            ["applied", "pending"]
        );
        assert_eq!(
            crate::library::get_sidecar(first.to_string_lossy().into_owned()).recipe,
            "target"
        );

        // This is the native part of the next-launch recovery flow: the startup UI cancels
        // the stale running worker, presents the persisted item report, then resumes pending work.
        c.execute(
            "UPDATE recipe_batches SET status='cancelled' WHERE id=? AND status='running'",
            [batch.id],
        )
        .unwrap();
        assert_eq!(get(&c, batch.id).unwrap().items[1].status, "pending");
        assert_eq!(resume(&mut c, batch.id, None).unwrap().status, "running");
        assert_eq!(apply(&c, batch.id, 1).unwrap().status, "applied");
        let recovered = get(&c, batch.id).unwrap();
        assert_eq!(recovered.status, "completed");
        assert!(recovered.items.iter().all(|item| item.status == "applied"));
        assert_eq!(
            crate::library::get_sidecar(second.to_string_lossy().into_owned()).recipe,
            "target"
        );
        drop(c);
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn reopen_apply_undo_and_preserve_later_edits() {
        let _cache = crate::library::isolate_cache_dir("recipe_batch_reopen");
        let dir = test_dir();
        let db = dir.join("catalog.db");
        let path = dir.join("photo.jpg").to_string_lossy().into_owned();
        std::fs::write(&path, b"photo").unwrap();
        crate::library::set_sidecar_run(
            path.clone(),
            3,
            "Green".into(),
            true,
            Some("original".into()),
            Some(true),
            None,
        )
        .unwrap();
        let mut c = Connection::open(&db).unwrap();
        let b = create(
            &mut c,
            "Paste".into(),
            vec![Input {
                path: path.clone(),
                recipe: "target".into(),
                expected_recipe: None,
                expected_active: None,
                error: None,
            }],
        )
        .unwrap();
        drop(c);
        let c = Connection::open(&db).unwrap();
        assert_eq!(get(&c, b.id).unwrap().items[0].status, "pending");
        assert_eq!(apply(&c, b.id, 0).unwrap().status, "applied");
        let sc = crate::library::get_sidecar(path.clone());
        assert_eq!(sc.recipe, "target");
        assert_eq!(sc.rating, 3);
        assert!(sc.favorite);
        c.execute(
            "UPDATE recipe_batches SET status='undoing' WHERE id=?",
            [b.id],
        )
        .unwrap();
        assert_eq!(undo(&c, b.id).unwrap().items[0].status, "undone");
        assert_eq!(crate::library::get_sidecar(path.clone()).recipe, "original");
        drop(c);
        let mut c = Connection::open(&db).unwrap();
        let b = create(
            &mut c,
            "Paste".into(),
            vec![Input {
                path: path.clone(),
                recipe: "target".into(),
                expected_recipe: None,
                expected_active: None,
                error: None,
            }],
        )
        .unwrap();
        apply(&c, b.id, 0).unwrap();
        crate::library::set_sidecar_run(
            path.clone(),
            3,
            "Green".into(),
            true,
            Some("later".into()),
            Some(true),
            None,
        )
        .unwrap();
        assert_eq!(undo(&c, b.id).unwrap().items[0].status, "conflict");
        assert_eq!(crate::library::get_sidecar(path).recipe, "later");
        drop(c);
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn crash_after_sidecar_write_replays_safely() {
        let _cache = crate::library::isolate_cache_dir("recipe_batch_crash");
        let dir = test_dir();
        let path = dir.join("photo.jpg").to_string_lossy().into_owned();
        std::fs::write(&path, b"photo").unwrap();
        let mut c = Connection::open(dir.join("db")).unwrap();
        let b = create(
            &mut c,
            "Paste".into(),
            vec![Input {
                path: path.clone(),
                recipe: "target".into(),
                expected_recipe: None,
                expected_active: None,
                error: None,
            }],
        )
        .unwrap();
        crate::library::set_sidecar_run(
            path.clone(),
            0,
            String::new(),
            true,
            Some("target".into()),
            None,
            None,
        )
        .unwrap();
        assert_eq!(apply(&c, b.id, 0).unwrap().status, "applied");
        assert_eq!(undo(&c, b.id).unwrap().items[0].status, "undone");
        assert_eq!(crate::library::get_sidecar(path).recipe, "");
        drop(c);
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn preparation_race_is_reported() {
        let _cache = crate::library::isolate_cache_dir("recipe_batch_race");
        let dir = test_dir();
        let path = dir.join("photo.jpg").to_string_lossy().into_owned();
        std::fs::write(&path, b"photo").unwrap();
        crate::library::set_sidecar_run(
            path.clone(),
            0,
            String::new(),
            true,
            Some("later".into()),
            None,
            None,
        )
        .unwrap();
        let mut c = Connection::open(dir.join("db")).unwrap();
        let b = create(
            &mut c,
            "Paste".into(),
            vec![Input {
                path: path.clone(),
                recipe: "target".into(),
                expected_recipe: Some("old".into()),
                expected_active: Some(0),
                error: None,
            }],
        )
        .unwrap();
        assert_eq!(b.status, "completed");
        assert_eq!(b.items[0].status, "failed");
        assert_eq!(crate::library::get_sidecar(path).recipe, "later");
        drop(c);
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    #[ignore = "real 5000-photo disk stress gate"]
    fn five_thousand_real_sidecars() {
        let _cache = crate::library::isolate_cache_dir("recipe_batch_5000");
        let dir = test_dir();
        let mut c = Connection::open(dir.join("db")).unwrap();
        c.pragma_update(None, "journal_mode", "WAL").unwrap();
        c.pragma_update(None, "synchronous", "NORMAL").unwrap();
        let mut items = Vec::new();
        for index in 0..5000 {
            let path = dir
                .join(format!("photo-{index}.jpg"))
                .to_string_lossy()
                .into_owned();
            std::fs::write(&path, b"photo").unwrap();
            items.push(Input {
                path,
                recipe: format!("recipe-{index}"),
                expected_recipe: Some(String::new()),
                expected_active: Some(0),
                error: None,
            });
        }
        let b = create(&mut c, "5000".into(), items).unwrap();
        for index in 0..5000 {
            assert_eq!(apply(&c, b.id, index).unwrap().status, "applied");
        }
        let b = get(&c, b.id).unwrap();
        assert_eq!(b.status, "completed");
        assert_eq!(b.items.len(), 5000);
        for item in b.items {
            assert_eq!(item.status, "applied");
            assert_eq!(crate::library::get_sidecar(item.path).recipe, item.recipe);
        }
        drop(c);
        let _ = std::fs::remove_dir_all(dir);
    }
    #[test]
    fn virtual_copy_switch_is_guarded() {
        let _cache = crate::library::isolate_cache_dir("recipe_batch_version");
        let dir = test_dir();
        let path = dir.join("photo.jpg").to_string_lossy().into_owned();
        std::fs::write(&path, b"photo").unwrap();
        crate::library::sidecar_add_version(path.clone(), "Copy".into()).unwrap();
        let mut c = Connection::open(dir.join("db")).unwrap();
        let b = create(
            &mut c,
            "Paste".into(),
            vec![Input {
                path: path.clone(),
                recipe: "target".into(),
                expected_recipe: None,
                expected_active: None,
                error: None,
            }],
        )
        .unwrap();
        crate::library::sidecar_set_active_version(path.clone(), 0).unwrap();
        assert_eq!(apply(&c, b.id, 0).unwrap().status, "failed");
        assert_ne!(crate::library::get_sidecar(path).recipe, "target");
        drop(c);
        let _ = std::fs::remove_dir_all(dir);
    }
}
