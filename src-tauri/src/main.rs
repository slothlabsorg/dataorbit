// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use commands::{connections, dynamo};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            connections::list_connections,
            connections::save_connection,
            connections::delete_connection,
            connections::test_connection,
            dynamo::list_tables,
            dynamo::query_table,
            dynamo::get_table_schema,
            dynamo::start_stream,
            dynamo::stop_stream,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DataOrbit");
}
