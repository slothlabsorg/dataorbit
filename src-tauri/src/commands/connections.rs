use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbConnection {
    pub id: String,
    pub name: String,
    pub db_type: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aws_region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aws_profile: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_connected: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_favorite: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct Store {
    pub connections: Vec<DbConnection>,
}

fn store_path() -> PathBuf {
    let base = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("dataorbit").join("connections.json")
}

pub fn load_store() -> Store {
    let path = store_path();
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_store(store: &Store) -> anyhow::Result<()> {
    let path = store_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(store)?;
    fs::write(path, json)?;
    Ok(())
}

#[tauri::command]
pub fn list_connections() -> Vec<DbConnection> {
    load_store().connections
}

#[tauri::command]
pub fn save_connection(conn: DbConnection) -> Result<DbConnection, String> {
    let mut store = load_store();
    let id = if conn.id.is_empty() {
        Uuid::new_v4().to_string()
    } else {
        conn.id.clone()
    };
    let new_conn = DbConnection { id: id.clone(), status: "disconnected".into(), ..conn };

    if let Some(existing) = store.connections.iter_mut().find(|c| c.id == id) {
        *existing = new_conn.clone();
    } else {
        store.connections.push(new_conn.clone());
    }

    save_store(&store).map_err(|e| e.to_string())?;
    Ok(new_conn)
}

#[tauri::command]
pub fn delete_connection(id: String) -> Result<(), String> {
    let mut store = load_store();
    store.connections.retain(|c| c.id != id);
    save_store(&store).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_connection(id: String) -> Result<serde_json::Value, String> {
    let store = load_store();
    let conn = store.connections.iter()
        .find(|c| c.id == id)
        .ok_or_else(|| format!("Connection {} not found", id))?
        .clone();

    match conn.db_type.as_str() {
        "dynamodb" => {
            let client = build_dynamo_client(&conn).await
                .map_err(|e| e.to_string())?;
            client.list_tables().limit(1).send().await
                .map(|_| serde_json::json!({ "ok": true }))
                .map_err(|e| e.to_string())
        }
        _ => Err(format!("DB type '{}' not yet supported", conn.db_type)),
    }
}

pub async fn build_dynamo_config(conn: &DbConnection) -> anyhow::Result<aws_config::SdkConfig> {
    use aws_config::meta::region::RegionProviderChain;

    let region = conn.aws_region.as_deref().unwrap_or("us-east-1");
    let region_provider = RegionProviderChain::first_try(
        aws_config::Region::new(region.to_string())
    );

    let mut loader = aws_config::from_env().region(region_provider);

    if let Some(profile) = &conn.aws_profile {
        loader = loader.profile_name(profile);
    }

    Ok(loader.load().await)
}

/// Build a DynamoDB client, applying endpoint_url override for DynamoDB Local.
pub async fn build_dynamo_client(conn: &DbConnection) -> anyhow::Result<aws_sdk_dynamodb::Client> {
    let cfg = build_dynamo_config(conn).await?;
    let mut builder = aws_sdk_dynamodb::config::Builder::from(&cfg);
    if let Some(ep) = &conn.endpoint {
        if !ep.is_empty() {
            builder = builder.endpoint_url(ep);
        }
    }
    Ok(aws_sdk_dynamodb::Client::from_conf(builder.build()))
}
