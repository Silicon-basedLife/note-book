// lib.rs —— NoteApp Tauri 薄壳装配
mod fs_store;

/// 注册全部存储命令（与 web 侧 StoragePort 一一对应）。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            fs_store::list_note_files,
            fs_store::read_note_file,
            fs_store::write_note_file,
            fs_store::remove_note_file,
            fs_store::read_meta,
            fs_store::write_meta,
            fs_store::remove_meta,
            fs_store::read_settings,
            fs_store::write_settings,
            fs_store::get_storage_info,
            fs_store::open_path,
            fs_store::pick_folder,
            fs_store::migrate_notes,
        ])
        .run(tauri::generate_context!())
        .expect("运行 NoteApp 失败");
}
