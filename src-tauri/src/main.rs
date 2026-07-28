// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod aws_http;
mod commands;

use commands::{connections, dynamo, profiles};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|_app| {
            // macOS uses titleBarStyle "Overlay" (native traffic lights overlaid on webview).
            // On Linux/Windows the native frame sits above the webview, causing a double titlebar.
            // Removing decorations lets our custom Titlebar be the sole chrome.
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            {
                use tauri::Manager;
                _app.get_webview_window("main").unwrap().set_decorations(false)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connections::list_connections,
            connections::save_connection,
            connections::delete_connection,
            connections::test_connection,
            connections::test_dynamo_config,
            dynamo::list_tables,
            dynamo::query_table,
            dynamo::get_table_schema,
            dynamo::put_item,
            dynamo::delete_item,
            dynamo::start_stream,
            dynamo::stop_stream,
            dynamo::execute_partiql,
            profiles::list_aws_profiles,
            profiles::list_aws_profiles_rich,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DataOrbit");
}
