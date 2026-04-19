use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use super::connections::{load_store, build_dynamo_client};
use aws_sdk_dynamodb::types::{AttributeValue, KeySchemaElement, KeyType};

/// Extract the attribute name for a given key type from a key schema slice.
fn key_attr(schema: &[KeySchemaElement], kt: &KeyType) -> Option<String> {
    schema.iter()
        .find(|k| k.key_type() == kt)
        .map(|k| k.attribute_name().to_string())
}

fn attr_to_value(attr: &AttributeValue) -> Value {
    match attr {
        AttributeValue::S(s)    => Value::String(s.clone()),
        AttributeValue::N(n)    => n.parse::<f64>()
                                    .map(|f| serde_json::json!(f))
                                    .unwrap_or(Value::String(n.clone())),
        AttributeValue::Bool(b) => Value::Bool(*b),
        AttributeValue::Null(_) => Value::Null,
        AttributeValue::L(list) => Value::Array(list.iter().map(attr_to_value).collect()),
        AttributeValue::M(map)  => Value::Object(
            map.iter().map(|(k, v)| (k.clone(), attr_to_value(v))).collect()
        ),
        AttributeValue::Ss(ss)  => Value::Array(ss.iter().map(|s| Value::String(s.clone())).collect()),
        AttributeValue::Ns(ns)  => Value::Array(ns.iter().map(|n| Value::String(n.clone())).collect()),
        AttributeValue::Bs(_)   => Value::String("<binary set>".into()),
        AttributeValue::B(_)    => Value::String("<binary>".into()),
        _ => Value::String(format!("{:?}", attr)),
    }
}

fn item_to_json(item: &HashMap<String, AttributeValue>) -> Value {
    Value::Object(item.iter().map(|(k, v)| (k.clone(), attr_to_value(v))).collect())
}

// ── Expression builder ────────────────────────────────────────────────────────
//
// Converts a list of FilterChips into DynamoDB expression components:
//   KeyConditionExpression  — pk/sk conditions (drives Query vs Scan)
//   FilterExpression        — all other attribute conditions
//
// Operator reference:
//   =  !=  <  <=  >  >=     → comparison
//   begins_with              → begins_with(#n, :v)
//   contains                 → contains(#n, :v)
//   exists                   → attribute_exists(#n)
//   not_exists               → attribute_not_exists(#n)
//   between                  → #n BETWEEN :v AND :v2
//   in                       → #n IN (:v0, :v1, …)

#[derive(Debug, Clone)]
pub struct FilterChipData {
    pub field:     String,
    pub op:        String,
    pub value:     String,
    pub value_end: Option<String>,
}

#[derive(Debug, Default)]
pub struct ExpressionParts {
    /// Assembled expression string (e.g. "#pk = :pk AND #sk BETWEEN :sk0 AND :sk1")
    pub expression:   String,
    /// #name → actual attribute name mappings
    pub attr_names:   HashMap<String, String>,
    /// :value → AttributeValue mappings
    pub attr_values:  HashMap<String, AttributeValue>,
    /// Human-readable description of what kind of operation this is
    pub op_mode:      OpMode,
}

#[derive(Debug, Default, PartialEq, Clone, Copy)]
pub enum OpMode {
    #[default]
    Scan,
    Query,
    IndexScan,
    IndexQuery,
}

/// Build KeyConditionExpression from pk/sk chips and FilterExpression from the rest.
pub fn build_expressions(
    chips:    &[FilterChipData],
    pk_field: &str,
    sk_field: Option<&str>,
    is_index: bool,
) -> (ExpressionParts, ExpressionParts) {
    let mut key_parts   = ExpressionParts::default();
    let mut filter_parts = ExpressionParts::default();
    let mut key_clauses: Vec<String>    = Vec::new();
    let mut filter_clauses: Vec<String> = Vec::new();

    for (i, chip) in chips.iter().enumerate() {
        let is_key = chip.field == pk_field || sk_field.map_or(false, |sk| chip.field == sk);
        // SK conditions that are valid in KeyConditionExpression
        let valid_key_op = matches!(chip.op.as_str(), "=" | "<" | "<=" | ">" | ">=" | "begins_with" | "between");
        // PK must always be =
        let is_pk = chip.field == pk_field;
        let use_as_key = is_key && valid_key_op && !(is_pk && chip.op != "=");

        let name_placeholder  = format!("#n{i}");
        let value_placeholder = format!(":v{i}");

        let parts = if use_as_key { &mut key_parts } else { &mut filter_parts };
        let clauses = if use_as_key { &mut key_clauses } else { &mut filter_clauses };

        parts.attr_names.insert(name_placeholder.clone(), chip.field.clone());

        let clause = match chip.op.as_str() {
            "="  | "!=" | "<" | "<=" | ">" | ">=" => {
                parts.attr_values.insert(value_placeholder.clone(), AttributeValue::S(chip.value.clone()));
                let op_str = match chip.op.as_str() {
                    "="  => "=",  "!=" => "<>",
                    "<"  => "<",  "<=" => "<=",
                    ">"  => ">",  ">=" => ">=",
                    _    => "=",
                };
                format!("{name_placeholder} {op_str} {value_placeholder}")
            }
            "begins_with" => {
                parts.attr_values.insert(value_placeholder.clone(), AttributeValue::S(chip.value.clone()));
                format!("begins_with({name_placeholder}, {value_placeholder})")
            }
            "contains" => {
                parts.attr_values.insert(value_placeholder.clone(), AttributeValue::S(chip.value.clone()));
                format!("contains({name_placeholder}, {value_placeholder})")
            }
            "exists" => {
                format!("attribute_exists({name_placeholder})")
            }
            "not_exists" => {
                format!("attribute_not_exists({name_placeholder})")
            }
            "between" => {
                let v2 = format!(":v{i}b");
                parts.attr_values.insert(value_placeholder.clone(), AttributeValue::S(chip.value.clone()));
                parts.attr_values.insert(v2.clone(), AttributeValue::S(
                    chip.value_end.clone().unwrap_or_default()
                ));
                format!("{name_placeholder} BETWEEN {value_placeholder} AND {v2}")
            }
            "in" => {
                // value is comma-separated
                let items: Vec<&str> = chip.value.split(',').map(str::trim).collect();
                let placeholders: Vec<String> = items.iter().enumerate().map(|(j, v)| {
                    let ph = format!(":v{i}i{j}");
                    parts.attr_values.insert(ph.clone(), AttributeValue::S(v.to_string()));
                    ph
                }).collect();
                format!("{name_placeholder} IN ({})", placeholders.join(", "))
            }
            _ => {
                parts.attr_values.insert(value_placeholder.clone(), AttributeValue::S(chip.value.clone()));
                format!("{name_placeholder} = {value_placeholder}")
            }
        };

        clauses.push(clause);
    }

    key_parts.expression    = key_clauses.join(" AND ");
    filter_parts.expression = filter_clauses.join(" AND ");

    // Determine op mode
    let has_pk = chips.iter().any(|c| c.field == pk_field && c.op == "=");
    key_parts.op_mode = match (has_pk, is_index) {
        (true, false)  => OpMode::Query,
        (true, true)   => OpMode::IndexQuery,
        (false, true)  => OpMode::IndexScan,
        (false, false) => OpMode::Scan,
    };

    (key_parts, filter_parts)
}

// ── list_tables ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableMetaOut {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub partition_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_key: Option<String>,
    pub billing_mode: Option<String>,
    pub stream_enabled: bool,
    pub indexes: Vec<IndexMetaOut>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexMetaOut {
    pub name: String,
    #[serde(rename = "type")]
    pub index_type: String,
    pub partition_key: String,
    pub sort_key: Option<String>,
    pub projection: String,
}

#[tauri::command]
pub async fn list_tables(connection_id: String) -> Result<Vec<TableMetaOut>, String> {
    let store = load_store();
    let conn = store.connections.iter()
        .find(|c| c.id == connection_id)
        .ok_or_else(|| format!("Connection {} not found", connection_id))?
        .clone();

    let client = build_dynamo_client(&conn).await.map_err(|e| e.to_string())?;

    let mut tables = Vec::new();
    let mut last = None::<String>;

    loop {
        let mut req = client.list_tables().limit(100);
        if let Some(ref lek) = last {
            req = req.exclusive_start_table_name(lek);
        }
        let resp = req.send().await.map_err(|e| e.to_string())?;
        let names = resp.table_names().to_vec();
        let done = resp.last_evaluated_table_name().is_none();
        last = resp.last_evaluated_table_name().map(|s| s.to_string());

        for name in names {
            let desc = client.describe_table().table_name(&name).send().await
                .map_err(|e| e.to_string())?;
            if let Some(t) = desc.table() {
                let partition_key = key_attr(t.key_schema(), &KeyType::Hash);
                let sort_key      = key_attr(t.key_schema(), &KeyType::Range);

                let billing_mode = t.billing_mode_summary()
                    .and_then(|b| b.billing_mode())
                    .map(|b| format!("{:?}", b));

                let stream_enabled = t.stream_specification()
                    .map(|s| s.stream_enabled())
                    .unwrap_or(false);

                let mut indexes: Vec<IndexMetaOut> = t.global_secondary_indexes().iter()
                    .map(|gsi| IndexMetaOut {
                        name:          gsi.index_name().unwrap_or("").to_string(),
                        index_type:    "GSI".into(),
                        partition_key: key_attr(gsi.key_schema(), &KeyType::Hash).unwrap_or_default(),
                        sort_key:      key_attr(gsi.key_schema(), &KeyType::Range),
                        projection:    gsi.projection()
                            .and_then(|p| p.projection_type())
                            .map(|pt| format!("{:?}", pt))
                            .unwrap_or_else(|| "ALL".into()),
                    })
                    .collect();

                indexes.extend(t.local_secondary_indexes().iter().map(|lsi| IndexMetaOut {
                    name:          lsi.index_name().unwrap_or("").to_string(),
                    index_type:    "LSI".into(),
                    partition_key: key_attr(lsi.key_schema(), &KeyType::Hash).unwrap_or_default(),
                    sort_key:      key_attr(lsi.key_schema(), &KeyType::Range),
                    projection:    lsi.projection()
                        .and_then(|p| p.projection_type())
                        .map(|pt| format!("{:?}", pt))
                        .unwrap_or_else(|| "ALL".into()),
                }));

                tables.push(TableMetaOut {
                    name,
                    item_count: t.item_count(),
                    size_bytes: t.table_size_bytes(),
                    partition_key,
                    sort_key,
                    billing_mode,
                    stream_enabled,
                    indexes,
                });
            }
        }

        if done { break; }
    }

    Ok(tables)
}

// ── get_table_schema ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_table_schema(connection_id: String, table: String) -> Result<TableMetaOut, String> {
    let store = load_store();
    let conn = store.connections.iter()
        .find(|c| c.id == connection_id)
        .ok_or_else(|| format!("Connection {} not found", connection_id))?
        .clone();

    let client = build_dynamo_client(&conn).await.map_err(|e| e.to_string())?;

    let desc = client.describe_table().table_name(&table).send()
        .await.map_err(|e| e.to_string())?;

    let t = desc.table().ok_or("No table description returned")?;

    Ok(TableMetaOut {
        name:          table,
        item_count:    t.item_count(),
        size_bytes:    t.table_size_bytes(),
        partition_key: key_attr(t.key_schema(), &KeyType::Hash),
        sort_key:      key_attr(t.key_schema(), &KeyType::Range),
        billing_mode:  t.billing_mode_summary()
            .and_then(|b| b.billing_mode())
            .map(|b| format!("{:?}", b)),
        stream_enabled: t.stream_specification()
            .map(|s| s.stream_enabled())
            .unwrap_or(false),
        indexes: vec![],
    })
}

// ── query_table ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterChipIn {
    pub field:     String,
    pub op:        String,
    pub value:     String,
    pub value_end: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryDefIn {
    pub connection_id:       String,
    pub table:               String,
    pub index_name:          Option<String>,
    pub partition_key_field: Option<String>,
    pub sort_key_field:      Option<String>,
    pub filters:             Vec<FilterChipIn>,
    pub limit:               i32,
    pub scan_index_forward:  Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResultOut {
    pub rows:              Vec<Value>,
    pub count:             i32,
    pub scanned_count:     i32,
    pub rcu_consumed:      Option<f64>,
    pub last_evaluated_key: Option<Value>,
    pub execution_ms:      u128,
    pub warnings:          Vec<String>,
    pub op_mode:           String,  // "Query" | "Scan" | "IndexQuery" | "IndexScan"
}

#[tauri::command]
pub async fn query_table(def: QueryDefIn) -> Result<QueryResultOut, String> {
    let store = load_store();
    let conn = store.connections.iter()
        .find(|c| c.id == def.connection_id)
        .ok_or_else(|| format!("Connection {} not found", def.connection_id))?
        .clone();

    let client = build_dynamo_client(&conn).await.map_err(|e| e.to_string())?;
    let start = std::time::Instant::now();

    let chips: Vec<FilterChipData> = def.filters.iter().map(|f| FilterChipData {
        field:     f.field.clone(),
        op:        f.op.clone(),
        value:     f.value.clone(),
        value_end: f.value_end.clone(),
    }).collect();

    let pk = def.partition_key_field.as_deref().unwrap_or("pk");
    let sk = def.sort_key_field.as_deref();
    let is_index = def.index_name.is_some();

    let (key_parts, filter_parts) = build_expressions(&chips, pk, sk, is_index);
    let op_mode = key_parts.op_mode;
    let mut warnings: Vec<String> = Vec::new();

    // Warn on costly operations
    if op_mode == OpMode::Scan || op_mode == OpMode::IndexScan {
        if !filter_parts.expression.is_empty() || !chips.is_empty() {
            warnings.push("FilterExpression applied after Scan — high RCU cost".into());
        }
    }
    if filter_parts.expression.contains("contains(") {
        warnings.push("contains() uses FilterExpression and scans all items that match the key condition".into());
    }

    let (rows, scanned_count, rcu) = if op_mode == OpMode::Query || op_mode == OpMode::IndexQuery {
        // ── Query path ────────────────────────────────────────────────────────
        let mut req = client.query()
            .table_name(&def.table)
            .limit(def.limit)
            .scan_index_forward(def.scan_index_forward.unwrap_or(true))
            .return_consumed_capacity(aws_sdk_dynamodb::types::ReturnConsumedCapacity::Total);

        if let Some(idx) = &def.index_name {
            req = req.index_name(idx);
        }

        // Key condition
        req = req.key_condition_expression(&key_parts.expression);
        for (k, v) in &key_parts.attr_names  { req = req.expression_attribute_names(k, v); }
        for (k, v) in &key_parts.attr_values { req = req.expression_attribute_values(k, v.clone()); }

        // Filter expression (applied after key lookup)
        if !filter_parts.expression.is_empty() {
            req = req.filter_expression(&filter_parts.expression);
            for (k, v) in &filter_parts.attr_names  { req = req.expression_attribute_names(k, v); }
            for (k, v) in &filter_parts.attr_values { req = req.expression_attribute_values(k, v.clone()); }
        }

        let resp = req.send().await.map_err(|e| e.to_string())?;
        (resp.items().to_vec(), resp.scanned_count(), resp.consumed_capacity().and_then(|c| c.capacity_units()))
    } else {
        // ── Scan path ─────────────────────────────────────────────────────────
        let mut req = client.scan()
            .table_name(&def.table)
            .limit(def.limit)
            .return_consumed_capacity(aws_sdk_dynamodb::types::ReturnConsumedCapacity::Total);

        if let Some(idx) = &def.index_name {
            req = req.index_name(idx);
        }

        // All chips become FilterExpression in Scan mode
        let all_chips: Vec<FilterChipData> = chips.clone();
        let (_, all_filter) = build_expressions(&all_chips, "__never__", None, false);
        if !all_filter.expression.is_empty() {
            req = req.filter_expression(&all_filter.expression);
            for (k, v) in &all_filter.attr_names  { req = req.expression_attribute_names(k, v); }
            for (k, v) in &all_filter.attr_values { req = req.expression_attribute_values(k, v.clone()); }
        }

        let resp = req.send().await.map_err(|e| e.to_string())?;
        (resp.items().to_vec(), resp.scanned_count(), resp.consumed_capacity().and_then(|c| c.capacity_units()))
    };

    let row_values: Vec<Value> = rows.iter().map(|item| item_to_json(item)).collect();

    Ok(QueryResultOut {
        count:              row_values.len() as i32,
        scanned_count,
        rcu_consumed:       rcu,
        last_evaluated_key: None,
        execution_ms:       start.elapsed().as_millis(),
        op_mode:            format!("{:?}", op_mode),
        warnings,
        rows:               row_values,
    })
}

// ── stream ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_stream(connection_id: String, table: String) -> Result<(), String> {
    // TODO: spawn async task to poll DynamoDB Streams and emit Tauri events
    let _ = (connection_id, table);
    Ok(())
}

#[tauri::command]
pub async fn stop_stream(connection_id: String) -> Result<(), String> {
    let _ = connection_id;
    Ok(())
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn chip(field: &str, op: &str, value: &str) -> FilterChipData {
        FilterChipData { field: field.into(), op: op.into(), value: value.into(), value_end: None }
    }

    fn chip_between(field: &str, v: &str, v2: &str) -> FilterChipData {
        FilterChipData { field: field.into(), op: "between".into(), value: v.into(), value_end: Some(v2.into()) }
    }

    // ── Query mode detection ──────────────────────────────────────────────────

    #[test]
    fn pk_eq_triggers_query_mode() {
        let chips = vec![chip("deviceId", "=", "sensor-001")];
        let (key, _filter) = build_expressions(&chips, "deviceId", Some("timestamp"), false);
        assert_eq!(key.op_mode, OpMode::Query);
        assert!(key.expression.contains("="));
    }

    #[test]
    fn no_pk_filter_triggers_scan_mode() {
        let chips = vec![chip("status", "=", "OK")];
        let (key, _filter) = build_expressions(&chips, "deviceId", Some("timestamp"), false);
        assert_eq!(key.op_mode, OpMode::Scan);
        assert!(key.expression.is_empty(), "No key condition when pk not filtered");
    }

    #[test]
    fn index_with_pk_triggers_index_query() {
        let chips = vec![chip("status", "=", "WARN")];
        let (key, _filter) = build_expressions(&chips, "status", Some("timestamp"), true);
        assert_eq!(key.op_mode, OpMode::IndexQuery);
    }

    #[test]
    fn index_without_pk_triggers_index_scan() {
        let chips = vec![chip("firmware", "begins_with", "v2")];
        let (key, _filter) = build_expressions(&chips, "status", Some("timestamp"), true);
        assert_eq!(key.op_mode, OpMode::IndexScan);
    }

    // ── Sort key range conditions ─────────────────────────────────────────────

    #[test]
    fn sort_key_between_goes_to_key_condition() {
        let chips = vec![
            chip("deviceId", "=", "sensor-001"),
            chip_between("timestamp", "1710330000000", "1710340000000"),
        ];
        let (key, filter) = build_expressions(&chips, "deviceId", Some("timestamp"), false);
        assert_eq!(key.op_mode, OpMode::Query);
        assert!(key.expression.contains("BETWEEN"), "sk BETWEEN must be in KeyConditionExpression, got: {}", key.expression);
        assert!(filter.expression.is_empty(), "BETWEEN on sk must NOT be in FilterExpression");
    }

    #[test]
    fn sort_key_begins_with_goes_to_key_condition() {
        let chips = vec![
            chip("status", "=", "OK"),
            chip("timestamp", "begins_with", "171033"),
        ];
        let (key, filter) = build_expressions(&chips, "status", Some("timestamp"), false);
        assert!(key.expression.contains("begins_with"), "begins_with on sk must be in KeyConditionExpression");
        assert!(filter.expression.is_empty());
    }

    #[test]
    fn sort_key_lt_gt_go_to_key_condition() {
        for op in ["<", "<=", ">", ">="] {
            let chips = vec![
                chip("deviceId", "=", "sensor-001"),
                chip("timestamp", op, "1710340000000"),
            ];
            let (key, filter) = build_expressions(&chips, "deviceId", Some("timestamp"), false);
            assert!(key.expression.contains(if op == "<" { "<" } else { op }), "op {} must be in key condition", op);
            assert!(filter.expression.is_empty(), "op {} must NOT be in filter expression", op);
        }
    }

    // ── Filter expression (non-key attributes) ────────────────────────────────

    #[test]
    fn contains_goes_to_filter_expression() {
        let chips = vec![
            chip("deviceId", "=", "sensor-001"),
            chip("firmware", "contains", "v2"),
        ];
        let (key, filter) = build_expressions(&chips, "deviceId", Some("timestamp"), false);
        assert_eq!(key.op_mode, OpMode::Query);
        assert!(filter.expression.contains("contains("), "contains() must be in FilterExpression");
    }

    #[test]
    fn begins_with_on_non_key_field_goes_to_filter() {
        let chips = vec![
            chip("deviceId", "=", "sensor-001"),
            chip("firmwareVersion", "begins_with", "v2"),
        ];
        let (_key, filter) = build_expressions(&chips, "deviceId", Some("timestamp"), false);
        assert!(filter.expression.contains("begins_with("), "begins_with on non-sk must be in FilterExpression");
    }

    #[test]
    fn not_eq_on_non_key_goes_to_filter() {
        let chips = vec![
            chip("deviceId", "=", "sensor-001"),
            chip("status", "!=", "OK"),
        ];
        let (_key, filter) = build_expressions(&chips, "deviceId", Some("timestamp"), false);
        assert!(filter.expression.contains("<>"), "!= must become <> in FilterExpression");
    }

    #[test]
    fn exists_not_exists_in_filter() {
        let chips = vec![
            chip("deviceId", "=", "sensor-001"),
            chip("battery", "exists", ""),
            chip("error", "not_exists", ""),
        ];
        let (_key, filter) = build_expressions(&chips, "deviceId", Some("timestamp"), false);
        assert!(filter.expression.contains("attribute_exists("));
        assert!(filter.expression.contains("attribute_not_exists("));
    }

    #[test]
    fn in_operator_expands_to_list() {
        let chips = vec![chip("status", "in", "OK, WARN, CRIT")];
        let (_, filter) = build_expressions(&chips, "deviceId", Some("timestamp"), false);
        assert!(filter.expression.contains("IN ("), "IN must expand to list, got: {}", filter.expression);
        assert_eq!(filter.attr_values.len(), 3, "Each IN item gets its own value placeholder");
    }

    // ── Expression attribute name/value wiring ────────────────────────────────

    #[test]
    fn attr_names_and_values_are_populated() {
        let chips = vec![chip("deviceId", "=", "sensor-001")];
        let (key, _) = build_expressions(&chips, "deviceId", Some("timestamp"), false);
        assert!(!key.attr_names.is_empty(),  "attr_names must be set");
        assert!(!key.attr_values.is_empty(), "attr_values must be set");
        // All values in the expression must have corresponding entries
        for (ph, _) in &key.attr_values {
            assert!(key.expression.contains(ph.as_str()), "Placeholder {} missing from expression", ph);
        }
    }

    #[test]
    fn between_has_two_value_placeholders() {
        let chips = vec![chip_between("timestamp", "1000", "2000")];
        let (_, filter) = build_expressions(&chips, "deviceId", None, false);
        assert_eq!(filter.attr_values.len(), 2, "BETWEEN needs exactly 2 value placeholders");
    }

    // ── pk != = goes to filter, not key condition ─────────────────────────────

    #[test]
    fn pk_inequality_goes_to_filter_not_key() {
        let chips = vec![chip("deviceId", ">", "sensor-000")];
        let (key, filter) = build_expressions(&chips, "deviceId", Some("timestamp"), false);
        // PK must be = for a Query — any other op on pk goes to FilterExpression (Scan)
        assert!(key.expression.is_empty(), "PK > must not be a key condition");
        assert!(filter.expression.contains(">"), "PK > must be in FilterExpression");
    }

    // ── Multiple filter chips ─────────────────────────────────────────────────

    #[test]
    fn multiple_filter_chips_joined_with_and() {
        let chips = vec![
            chip("deviceId", "=", "sensor-001"),
            chip("status",   "=", "WARN"),
            chip("battery",  "<", "20"),
        ];
        let (key, filter) = build_expressions(&chips, "deviceId", Some("timestamp"), false);
        assert_eq!(key.op_mode, OpMode::Query);
        let ands = filter.expression.matches("AND").count();
        assert_eq!(ands, 1, "Two filter chips → one AND, got: {}", filter.expression);
    }
}
