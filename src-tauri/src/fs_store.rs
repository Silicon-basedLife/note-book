// fs_store.rs —— Tauri 薄壳核心：实现 web/src/lib/core/storage/port.ts 的 StoragePort
// 对应 docs/TECH_DESIGN.md §3.1：
//   - 笔记文件：%APPDATA%\com.noteapp.desktop\notes\<id>.md（一条笔记一个文件）
//   - 元数据：  %APPDATA%\com.noteapp.desktop\meta.json（键值，如文件夹列表）
// 索引/搜索/Markdown/待办等逻辑留在 UI 侧（web/src/lib/core，已由单测覆盖），
// Rust 面严格限制在“薄壳核心”的文件读写边界内（技术方案 §1.1/§2）。
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const NOTES_DIR: &str = "notes";
const META_FILE: &str = "meta.json";

fn base_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    Ok(dir)
}

fn notes_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = base_dir(app)?.join(NOTES_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("创建 notes 目录失败: {e}"))?;
    Ok(dir)
}

/// 文件名白名单：仅允许普通文件名（拒绝路径分隔符/相对路径），防止目录穿越。
fn sanitize_name(name: &str) -> Result<String, String> {
    let n = name.trim();
    if n.is_empty() || n == "." || n == ".." {
        return Err("非法文件名".into());
    }
    if n.contains('/') || n.contains('\\') || n.contains('\0') {
        return Err("文件名包含非法字符".into());
    }
    Ok(n.to_string())
}

fn meta_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(base_dir(app)?.join(META_FILE))
}

fn read_meta_map(app: &AppHandle) -> Result<serde_json::Map<String, Value>, String> {
    let path = meta_file(app)?;
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("读取 meta.json 失败: {e}"))?;
    let parsed: Value = serde_json::from_str(&text).map_err(|e| format!("meta.json 解析失败: {e}"))?;
    match parsed {
        Value::Object(map) => Ok(map),
        _ => Ok(serde_json::Map::new()),
    }
}

fn write_meta_map(app: &AppHandle, map: &serde_json::Map<String, Value>) -> Result<(), String> {
    let path = meta_file(app)?;
    let text = serde_json::to_string_pretty(map).map_err(|e| format!("meta.json 序列化失败: {e}"))?;
    fs::write(&path, text).map_err(|e| format!("写入 meta.json 失败: {e}"))
}

// ---------- 笔记文件命令 ----------

#[tauri::command]
pub fn list_note_files(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = notes_dir(&app)?;
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取 notes 目录失败: {e}"))?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if entry.path().is_file() && name.ends_with(".md") {
            out.push(name);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn read_note_file(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let safe = sanitize_name(&name)?;
    let path = notes_dir(&app)?.join(safe);
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取笔记失败: {e}")),
    }
}

#[tauri::command]
pub fn write_note_file(app: AppHandle, name: String, content: String) -> Result<(), String> {
    let safe = sanitize_name(&name)?;
    let path = notes_dir(&app)?.join(safe);
    fs::write(&path, content).map_err(|e| format!("写入笔记失败: {e}"))
}

#[tauri::command]
pub fn remove_note_file(app: AppHandle, name: String) -> Result<(), String> {
    let safe = sanitize_name(&name)?;
    let path = notes_dir(&app)?.join(safe);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("删除笔记失败: {e}")),
    }
}

// ---------- 元数据 KV 命令 ----------

#[tauri::command]
pub fn read_meta(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let map = read_meta_map(&app)?;
    match map.get(&key) {
        Some(Value::String(v)) => Ok(Some(v.clone())),
        _ => Ok(None),
    }
}

#[tauri::command]
pub fn write_meta(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let mut map = read_meta_map(&app)?;
    map.insert(key, Value::String(value));
    write_meta_map(&app, &map)
}

#[tauri::command]
pub fn remove_meta(app: AppHandle, key: String) -> Result<(), String> {
    let mut map = read_meta_map(&app)?;
    map.remove(&key);
    write_meta_map(&app, &map)
}
