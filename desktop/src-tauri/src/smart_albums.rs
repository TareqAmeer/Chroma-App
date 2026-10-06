//! Persisted, catalog-backed smart albums. The saved AST is a small allow-listed language,
//! never SQL; its compiler maps enum variants to fixed columns/operators and binds every value.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::catalog::CatalogState;

const RULE_VERSION: u8 = 1;
const MAX_DEPTH: usize = 4;
const MAX_RULES: usize = 32;
const MAX_SOURCES: usize = 64;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartAlbumRuleSet {
    pub version: u8,
    pub root: SmartRule,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SmartRule {
    Group {
        match_mode: MatchMode,
        rules: Vec<SmartRule>,
    },
    Condition {
        field: RuleField,
        operator: RuleOperator,
        value: RuleValue,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchMode {
    All,
    Any,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RuleField {
    Rating,
    Edited,
    Favorite,
    CaptureYear,
    Camera,
    MediaKind,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RuleOperator {
    Equals,
    AtLeast,
    AtMost,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub enum RuleValue {
    Number(i64),
    Boolean(bool),
    Text(String),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartAlbumInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub source_root_ids: Vec<i64>,
    pub rule_set: SmartAlbumRuleSet,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartAlbumSummary {
    pub id: String,
    pub name: String,
    pub source_root_ids: Vec<i64>,
    pub source_labels: Vec<String>,
    pub rule_set: SmartAlbumRuleSet,
    pub match_count: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartAlbumSource {
    pub id: i64,
    pub label: String,
}

type BoundValue = Box<dyn rusqlite::types::ToSql>;

fn validate_rule_set(rule_set: &SmartAlbumRuleSet) -> Result<(), String> {
    if rule_set.version != RULE_VERSION {
        return Err(format!(
            "unsupported smart album rule version {}",
            rule_set.version
        ));
    }
    let mut count = 0;
    validate_rule(&rule_set.root, 0, &mut count)
}

fn validate_rule(rule: &SmartRule, depth: usize, count: &mut usize) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err(format!(
            "smart album rules may be nested at most {MAX_DEPTH} levels"
        ));
    }
    match rule {
        SmartRule::Group { rules, .. } => {
            if rules.is_empty() {
                return Err("a rule group needs at least one condition".into());
            }
            for child in rules {
                validate_rule(child, depth + 1, count)?;
            }
        }
        SmartRule::Condition {
            field,
            operator,
            value,
        } => {
            *count += 1;
            if *count > MAX_RULES {
                return Err(format!(
                    "a smart album can have at most {MAX_RULES} conditions"
                ));
            }
            validate_condition(*field, *operator, value)?;
        }
    }
    Ok(())
}

fn validate_condition(
    field: RuleField,
    operator: RuleOperator,
    value: &RuleValue,
) -> Result<(), String> {
    let numeric = matches!(field, RuleField::Rating | RuleField::CaptureYear);
    let boolean = matches!(field, RuleField::Edited | RuleField::Favorite);
    if numeric {
        let RuleValue::Number(n) = value else {
            return Err("this rule needs a numeric value".into());
        };
        match field {
            RuleField::Rating if !(-1..=5).contains(n) => {
                return Err("rating must be between rejected (-1) and five stars".into())
            }
            RuleField::CaptureYear if !(1..=9999).contains(n) => {
                return Err("capture year must be between 1 and 9999".into())
            }
            _ => {}
        }
    } else if boolean {
        if !matches!(operator, RuleOperator::Equals) || !matches!(value, RuleValue::Boolean(_)) {
            return Err("edited and favorite rules use equals with true or false".into());
        }
    } else {
        let RuleValue::Text(text) = value else {
            return Err("this rule needs text".into());
        };
        if !matches!(operator, RuleOperator::Equals) {
            return Err("camera and media type rules use equals".into());
        }
        if text.trim().is_empty() || text.len() > 160 {
            return Err("text rule must contain 1–160 characters".into());
        }
    }
    Ok(())
}

fn compile_rule(rule: &SmartRule, values: &mut Vec<BoundValue>) -> String {
    match rule {
        SmartRule::Group { match_mode, rules } => {
            let joiner = match match_mode {
                MatchMode::All => " AND ",
                MatchMode::Any => " OR ",
            };
            let children = rules
                .iter()
                .map(|r| compile_rule(r, values))
                .collect::<Vec<_>>();
            format!("({})", children.join(joiner))
        }
        SmartRule::Condition {
            field,
            operator,
            value,
        } => {
            // SQL fragments are derived only from enums. Neither user-provided field/operator
            // text nor a value is interpolated into the statement.
            let column = match field {
                RuleField::Rating => "p.rating",
                RuleField::Edited => "p.edited",
                RuleField::Favorite => "p.favorite",
                RuleField::CaptureYear => "p.cap_y",
                RuleField::Camera => "p.camera",
                RuleField::MediaKind => "p.kind",
            };
            let operator_sql = match operator {
                RuleOperator::Equals => "=",
                RuleOperator::AtLeast => ">=",
                RuleOperator::AtMost => "<=",
            };
            values.push(match value {
                RuleValue::Number(n) => Box::new(*n),
                RuleValue::Boolean(b) => Box::new(*b as i64),
                RuleValue::Text(s) => Box::new(s.clone()),
            });
            format!("{column} {operator_sql} ?{}", values.len())
        }
    }
}

fn validate_source_ids(conn: &Connection, ids: &[i64]) -> Result<(), String> {
    validate_source_shape(ids)?;
    let marks = (0..ids.len())
        .map(|i| format!("?{}", i + 1))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("SELECT COUNT(DISTINCT id) FROM roots WHERE id IN ({marks})");
    let values: Vec<&dyn rusqlite::types::ToSql> = ids
        .iter()
        .map(|id| id as &dyn rusqlite::types::ToSql)
        .collect();
    let found: i64 = conn
        .query_row(&sql, values.as_slice(), |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if found != ids.len() as i64 {
        return Err("one or more selected catalog folders are no longer available".into());
    }
    Ok(())
}

fn validate_source_shape(ids: &[i64]) -> Result<(), String> {
    if ids.is_empty() || ids.len() > MAX_SOURCES {
        return Err(format!(
            "choose between 1 and {MAX_SOURCES} catalog folders"
        ));
    }
    if ids.iter().any(|id| *id <= 0) {
        return Err("catalog folder IDs must be positive".into());
    }
    if ids
        .iter()
        .copied()
        .collect::<std::collections::HashSet<_>>()
        .len()
        != ids.len()
    {
        return Err("a catalog folder can only be selected once".into());
    }
    Ok(())
}

fn create_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS smart_albums (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, source_root_ids TEXT NOT NULL,
        rule_set TEXT NOT NULL, updated_at INTEGER NOT NULL
    ); CREATE UNIQUE INDEX IF NOT EXISTS ix_smart_albums_name ON smart_albums(lower(name));",
    )
}

fn compile_album(
    conn: &Connection,
    id: &str,
    values: &mut Vec<BoundValue>,
) -> Result<String, String> {
    let (source_json, rule_json): (String, String) = conn
        .query_row(
            "SELECT source_root_ids, rule_set FROM smart_albums WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| format!("load smart album: {e}"))?;
    let source_ids: Vec<i64> =
        serde_json::from_str(&source_json).map_err(|e| format!("read smart album sources: {e}"))?;
    let rule_set: SmartAlbumRuleSet =
        serde_json::from_str(&rule_json).map_err(|e| format!("read smart album rules: {e}"))?;
    // A folder can be removed after the rule is saved. Keep the rule intact (its count becomes
    // zero and the UI labels the missing source) rather than making the whole album unloadable.
    validate_source_shape(&source_ids)?;
    validate_rule_set(&rule_set)?;
    let marks = source_ids
        .iter()
        .map(|source_id| {
            values.push(Box::new(*source_id));
            format!("?{}", values.len())
        })
        .collect::<Vec<_>>()
        .join(",");
    let source_sql = format!("EXISTS (SELECT 1 FROM roots r WHERE r.id IN ({marks}) AND r.volume_id=p.volume_id AND (r.rel_path='' OR p.rel_dir=r.rel_path OR substr(p.rel_dir,1,length(r.rel_path)+1)=r.rel_path || '/'))");
    let rule_sql = compile_rule(&rule_set.root, values);
    Ok(format!("{source_sql} AND {rule_sql}"))
}

pub(crate) fn append_query_scope(
    conn: &Connection,
    id: &str,
    values: &mut Vec<BoundValue>,
) -> Result<String, String> {
    compile_album(conn, id, values)
}

fn source_rows(conn: &Connection) -> Result<Vec<SmartAlbumSource>, String> {
    let mut stmt = conn.prepare("SELECT r.id,v.label,r.rel_path FROM roots r JOIN volumes v ON v.id=r.volume_id ORDER BY lower(v.label),r.rel_path").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let label: String = r.get(1)?;
            let rel_path: String = r.get(2)?;
            Ok(SmartAlbumSource {
                id: r.get(0)?,
                label: if rel_path.is_empty() {
                    label
                } else {
                    format!("{label} / {rel_path}")
                },
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn summary_run(conn: &Connection, id: &str) -> Result<SmartAlbumSummary, String> {
    let (name, sources_json, rules_json): (String, String, String) = conn
        .query_row(
            "SELECT name,source_root_ids,rule_set FROM smart_albums WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    let source_root_ids: Vec<i64> =
        serde_json::from_str(&sources_json).map_err(|e| e.to_string())?;
    let rule_set: SmartAlbumRuleSet =
        serde_json::from_str(&rules_json).map_err(|e| e.to_string())?;
    validate_rule_set(&rule_set)?;
    let mut values = Vec::<BoundValue>::new();
    let where_sql = compile_album(conn, id, &mut values)?;
    let refs: Vec<&dyn rusqlite::types::ToSql> = values.iter().map(|x| x.as_ref()).collect();
    let count = conn.query_row(&format!("SELECT COUNT(*) FROM photos p WHERE p.present=1 AND (p.stack_id IS NULL OR p.stack_id=p.id) AND ({where_sql})"), refs.as_slice(), |r| r.get(0)).map_err(|e| e.to_string())?;
    let all_sources = source_rows(conn)?;
    let source_labels = source_root_ids
        .iter()
        .map(|source_id| {
            all_sources
                .iter()
                .find(|s| s.id == *source_id)
                .map(|s| s.label.clone())
                .unwrap_or_else(|| format!("Unavailable folder #{source_id}"))
        })
        .collect();
    Ok(SmartAlbumSummary {
        id: id.into(),
        name,
        source_root_ids,
        source_labels,
        rule_set,
        match_count: count,
    })
}

fn save_run(conn: &Connection, mut input: SmartAlbumInput) -> Result<SmartAlbumSummary, String> {
    create_schema(conn).map_err(|e| e.to_string())?;
    input.name = input.name.trim().to_string();
    if input.name.is_empty() || input.name.chars().count() > 80 {
        return Err("smart album name must contain 1–80 characters".into());
    }
    validate_source_ids(conn, &input.source_root_ids)?;
    validate_rule_set(&input.rule_set)?;
    let source_json = serde_json::to_string(&input.source_root_ids).map_err(|e| e.to_string())?;
    let rule_json = serde_json::to_string(&input.rule_set).map_err(|e| e.to_string())?;
    let is_update = input.id.is_some();
    let id = input.id.clone().unwrap_or_else(|| {
        format!(
            "sa-{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            std::process::id()
        )
    });
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let duplicate: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM smart_albums WHERE lower(name)=lower(?1) AND id!=?2)",
            params![input.name, id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if duplicate {
        return Err(format!(
            "a smart album named \"{}\" already exists",
            input.name
        ));
    }
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM smart_albums WHERE id=?1)",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if is_update && !exists {
        return Err("no such smart album".into());
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    tx.execute("INSERT INTO smart_albums(id,name,source_root_ids,rule_set,updated_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET name=excluded.name,source_root_ids=excluded.source_root_ids,rule_set=excluded.rule_set,updated_at=excluded.updated_at",params![id,input.name,source_json,rule_json,now]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    summary_run(conn, &id)
}

#[tauri::command]
pub fn smart_album_sources(
    state: tauri::State<'_, CatalogState>,
) -> Result<Vec<SmartAlbumSource>, String> {
    let conn = state.read_conn.lock().map_err(|e| e.to_string())?;
    source_rows(&conn)
}

#[tauri::command]
pub fn smart_album_list(
    state: tauri::State<'_, CatalogState>,
) -> Result<Vec<SmartAlbumSummary>, String> {
    let conn = state.read_conn.lock().map_err(|e| e.to_string())?;
    let ids = {
        let mut stmt = conn
            .prepare("SELECT id FROM smart_albums ORDER BY lower(name)")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        rows
    };
    ids.iter().map(|id| summary_run(&conn, id)).collect()
}

#[tauri::command]
pub fn smart_album_save(
    input: SmartAlbumInput,
    state: tauri::State<'_, CatalogState>,
) -> Result<SmartAlbumSummary, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    save_run(&conn, input)
}

#[tauri::command]
pub fn smart_album_delete(id: String, state: tauri::State<'_, CatalogState>) -> Result<(), String> {
    let removed = state
        .conn
        .lock()
        .map_err(|e| e.to_string())?
        .execute("DELETE FROM smart_albums WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    if removed == 0 {
        return Err("no such smart album".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE volumes(id INTEGER PRIMARY KEY,label TEXT NOT NULL); CREATE TABLE roots(id INTEGER PRIMARY KEY,volume_id INTEGER NOT NULL,rel_path TEXT NOT NULL); CREATE TABLE photos(id INTEGER PRIMARY KEY,volume_id INTEGER,rel_dir TEXT,present INTEGER,stack_id INTEGER,rating INTEGER,edited INTEGER,favorite INTEGER,cap_y INTEGER,camera TEXT,kind TEXT); INSERT INTO volumes VALUES(1,'Test Library'); INSERT INTO roots VALUES(10,1,'2026'); INSERT INTO photos VALUES(1,1,'2026',1,NULL,5,1,0,2026,'Camera A','raw'); INSERT INTO photos VALUES(2,1,'2026/trip',1,NULL,2,0,1,2025,'Camera B','jpeg'); INSERT INTO photos VALUES(3,1,'2025',1,NULL,5,1,0,2026,'Camera A','raw'); INSERT INTO photos VALUES(4,1,'2026',0,NULL,5,1,0,2026,'Camera A','raw');").unwrap();
        conn
    }
    fn set(root: SmartRule) -> SmartAlbumRuleSet {
        SmartAlbumRuleSet {
            version: RULE_VERSION,
            root,
        }
    }
    #[test]
    fn nested_all_any_scope_and_membership_are_live() {
        let conn = db();
        let input = SmartAlbumInput {
            id: None,
            name: "Current selects".into(),
            source_root_ids: vec![10],
            rule_set: set(SmartRule::Group {
                match_mode: MatchMode::All,
                rules: vec![
                    SmartRule::Condition {
                        field: RuleField::CaptureYear,
                        operator: RuleOperator::Equals,
                        value: RuleValue::Number(2026),
                    },
                    SmartRule::Group {
                        match_mode: MatchMode::Any,
                        rules: vec![
                            SmartRule::Condition {
                                field: RuleField::Rating,
                                operator: RuleOperator::AtLeast,
                                value: RuleValue::Number(4),
                            },
                            SmartRule::Condition {
                                field: RuleField::Favorite,
                                operator: RuleOperator::Equals,
                                value: RuleValue::Boolean(true),
                            },
                        ],
                    },
                ],
            }),
        };
        let saved = save_run(&conn, input).unwrap();
        assert_eq!(saved.match_count, 1);
        conn.execute("UPDATE photos SET favorite=1 WHERE id=3", [])
            .unwrap();
        assert_eq!(summary_run(&conn, &saved.id).unwrap().match_count, 1);
        conn.execute("UPDATE photos SET rel_dir='2026/elsewhere' WHERE id=3", [])
            .unwrap();
        assert_eq!(summary_run(&conn, &saved.id).unwrap().match_count, 2);
    }
    #[test]
    fn text_values_are_bound_and_invalid_version_or_sources_are_rejected() {
        let conn = db();
        let input = SmartAlbumInput {
            id: None,
            name: "Injection-safe".into(),
            source_root_ids: vec![10],
            rule_set: set(SmartRule::Condition {
                field: RuleField::Camera,
                operator: RuleOperator::Equals,
                value: RuleValue::Text("x' OR 1=1 --".into()),
            }),
        };
        let saved = save_run(&conn, input).unwrap();
        assert_eq!(saved.match_count, 0);
        let mut values = Vec::<BoundValue>::new();
        let sql = append_query_scope(&conn, &saved.id, &mut values).unwrap();
        assert!(!sql.contains("OR 1=1"));
        assert_eq!(values.len(), 2);
        let mut bad = set(SmartRule::Condition {
            field: RuleField::Rating,
            operator: RuleOperator::Equals,
            value: RuleValue::Number(6),
        });
        bad.version = 99;
        assert!(validate_rule_set(&bad).is_err());
        assert!(validate_source_ids(&conn, &[999]).is_err());
    }
}
