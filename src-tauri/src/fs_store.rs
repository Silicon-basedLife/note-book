// fs_store.rs —— Tauri 薄壳核心：实现 web/src/lib/core/storage/port.ts 的 StoragePort
// 对应 docs/TECH_DESIGN.md §3.1：
//   - 笔记：notes 目录下 <id>.md（默认 %APPDATA%\com.noteapp.desktop\notes\，可在设置中迁移）
//   - 元数据：notes 目录内 meta.json（随笔记目录一起迁移）
//   - 设置：应用配置目录 settings.json；存储位置指针：storage.json
// 索引/搜索/Markdown/待办等逻辑留在 UI 侧（web/src/lib/core，已由单测覆盖），
// Rust 面严格限制在“薄壳核心”的文件读写边界内（技术方案 §1.1/§2）。
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const NOTES_DIR: &str = "notes";
const META_FILE: &str = "meta.json";
const SETTINGS_FILE: &str = "settings.json";
const STORAGE_FILE: &str = "storage.json";

fn base_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    Ok(dir)
}

/// 用户在设置里指定的自定义笔记目录（storage.json 中的 notesDir）
fn read_storage_override(app: &AppHandle) -> Option<PathBuf> {
    let path = base_dir(app).ok()?.join(STORAGE_FILE);
    let text = fs::read_to_string(path).ok()?;
    let parsed: Value = serde_json::from_str(&text).ok()?;
    parsed
        .get("notesDir")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

/// 当前笔记根目录：自定义优先，否则默认 <数据目录>/notes；
/// 同时把历史版本遗留在数据目录根部的 meta.json 迁移进 notes 目录（一次性兼容）。
fn notes_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = base_dir(app)?;
    let dir = match read_storage_override(app) {
        Some(custom) => custom,
        None => base.join(NOTES_DIR),
    };
    fs::create_dir_all(&dir).map_err(|e| format!("创建笔记目录失败: {e}"))?;
    if dir != base {
        let legacy = base.join(META_FILE);
        let target = dir.join(META_FILE);
        if !target.exists() && legacy.exists() {
            let _ = fs::rename(&legacy, &target);
        }
    }
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
    Ok(notes_root(app)?.join(META_FILE))
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
    let dir = notes_root(&app)?;
    let mut out = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取笔记目录失败: {e}"))?;
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
    let path = notes_root(&app)?.join(safe);
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("读取笔记失败: {e}")),
    }
}

#[tauri::command]
pub fn write_note_file(app: AppHandle, name: String, content: String) -> Result<(), String> {
    let safe = sanitize_name(&name)?;
    let path = notes_root(&app)?.join(safe);
    fs::write(&path, content).map_err(|e| format!("写入笔记失败: {e}"))
}

#[tauri::command]
pub fn remove_note_file(app: AppHandle, name: String) -> Result<(), String> {
    let safe = sanitize_name(&name)?;
    let path = notes_root(&app)?.join(safe);
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

// ---------- 设置文件命令 ----------

#[tauri::command]
pub fn read_settings(app: AppHandle) -> Result<Option<String>, String> {
    let path = base_dir(&app)?.join(SETTINGS_FILE);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path).map(Some).map_err(|e| format!("读取设置失败: {e}"))
}

#[tauri::command]
pub fn write_settings(app: AppHandle, content: String) -> Result<(), String> {
    let path = base_dir(&app)?.join(SETTINGS_FILE);
    fs::write(&path, content).map_err(|e| format!("写入设置失败: {e}"))
}

// ---------- 存储位置管理 ----------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    app_version: String,
    data_dir: String,
    notes_dir: String,
    default_notes_dir: String,
    settings_file: String,
    is_custom: bool,
}

fn storage_info(app: &AppHandle) -> Result<StorageInfo, String> {
    let base = base_dir(app)?;
    let notes = notes_root(app)?;
    Ok(StorageInfo {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        data_dir: base.to_string_lossy().to_string(),
        notes_dir: notes.to_string_lossy().to_string(),
        default_notes_dir: base.join(NOTES_DIR).to_string_lossy().to_string(),
        settings_file: base.join(SETTINGS_FILE).to_string_lossy().to_string(),
        is_custom: read_storage_override(app).is_some(),
    })
}

#[tauri::command]
pub fn get_storage_info(app: AppHandle) -> Result<StorageInfo, String> {
    storage_info(&app)
}

fn open_in_file_manager(path: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        // `cmd /C start "" "<path>"` 比直接 explorer 更稳（explorer 的返回码/前台行为不统一）
        std::process::Command::new("cmd")
            .args(["/C", "start", ""])
            .arg(path)
            .spawn()
            .map(|_| ())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn().map(|_| ())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(path).spawn().map(|_| ())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    {
        let _ = path;
        Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "unsupported platform"))
    }
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let p = PathBuf::from(path.trim());
    if !p.exists() {
        return Err(format!("路径不存在：{}", p.to_string_lossy()));
    }
    open_in_file_manager(&p).map_err(|e| format!("打开目录失败: {e}"))
}

/// 弹出系统原生的“选择文件夹”对话框；用户取消时返回 None
#[tauri::command]
pub fn pick_folder() -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("选择笔记存储目录")
        .pick_folder();
    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

/// 迁移笔记目录：把当前 notes 下的 .md 与 meta.json 复制到目标目录，成功后写入 storage.json。
/// 目标目录要求为空（或仅含 .md / meta.json）；失败时不改动现有配置。
#[tauri::command]
pub fn migrate_notes(app: AppHandle, target: String) -> Result<StorageInfo, String> {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return Err("目标目录不能为空".into());
    }
    let current = notes_root(&app)?;
    let dest = PathBuf::from(trimmed);
    fs::create_dir_all(&dest).map_err(|e| format!("创建目标目录失败: {e}"))?;

    let cur_key = fs::canonicalize(&current).unwrap_or_else(|_| current.clone());
    let dst_key = fs::canonicalize(&dest).unwrap_or_else(|_| dest.clone());
    if cur_key == dst_key {
        return Err("目标目录与当前笔记目录相同".into());
    }

    // 目标目录须为空或只含笔记文件，避免误覆盖用户其它数据
    if let Ok(entries) = fs::read_dir(&dest) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !(name.ends_with(".md") || name == META_FILE) {
                return Err(format!("目标目录包含其它文件（{name}），请选择空目录"));
            }
        }
    }

    let mut copied = 0usize;
    let entries = fs::read_dir(&current).map_err(|e| format!("读取当前笔记目录失败: {e}"))?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let is_note = name.ends_with(".md") || name == META_FILE;
        if !entry.path().is_file() || !is_note {
            continue;
        }
        fs::copy(entry.path(), dest.join(&name)).map_err(|e| format!("复制 {name} 失败: {e}"))?;
        copied += 1;
    }
    let _ = copied;

    let pointer = serde_json::json!({ "notesDir": dst_key.to_string_lossy() });
    let text = serde_json::to_string_pretty(&pointer).map_err(|e| format!("写入存储配置失败: {e}"))?;
    fs::write(base_dir(&app)?.join(STORAGE_FILE), text).map_err(|e| format!("保存存储配置失败: {e}"))?;

    storage_info(&app)
}
