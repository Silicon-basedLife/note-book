// lib.rs —— NoteApp Tauri 薄壳装配
mod fs_store;

use std::io::Write;
use std::path::PathBuf;

/// 日志文件路径：优先 exe 同目录（好找），失败则退到 %TEMP%。
/// release 是 `windows_subsystem = "windows"`（见 main.rs），**stderr 会被系统丢弃**，
/// 所以必须落文件，否则 panic 对用户完全不可见 —— 2026-09-30 的"应用打不开"事故里，
/// 我们花了很久才意识到失败发生在 Tauri 的 setup()（窗口/WebView2 创建）阶段。
fn log_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            return dir.join("noteapp-log.txt");
        }
    }
    let base = std::env::var("TEMP")
        .or_else(|_| std::env::var("TMP"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("noteapp-log.txt")
}

/// 追加一行到日志（超过 256KB 就先截断，避免无限增长）。
fn append_log(text: &str) {
    let path = log_path();
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > 256 * 1024 {
            let _ = std::fs::remove_file(&path);
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = f.write_all(text.as_bytes());
    }
}

/// 启动上下文：把 cwd / 参数 / 令牌线索记录下来。
/// 起因：同一个 exe 用 PowerShell(Start-Process) 启动正常，用资源管理器双击却"闪一下就消失"，
/// 怀疑是**受限令牌**启动导致写不了 WebView2 profile（沙箱里复现到的是
/// `Failed to setup app: 拒绝访问 (os error 5)`）。记录 cwd 至少能区分两种启动方式。
fn log_startup() {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let cwd = std::env::current_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|_| "?".into());
    let args: Vec<String> = std::env::args().collect();
    append_log(&format!(
        "\n=== NoteApp start (epoch {secs}) ===\nversion: {}\ncwd: {cwd}\nargs: {args:?}\n",
        env!("CARGO_PKG_VERSION")
    ));
    log_dir_probe();
}

/// 启动自检：把"应用数据目录能不能写"记进日志。
/// 这是本次事故的决定性判据：如果双击（经资源管理器/安全框）启动时进程被降权，
/// 这里会立刻失败，而 Tauri 随后创建 WebView2 时就会报
/// `Failed to setup app: 拒绝访问 (os error 5)` —— 窗口闪一下然后消失。
fn log_dir_probe() {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    if local.is_empty() {
        append_log("LOCALAPPDATA: (not set)\n");
        return;
    }
    let app_dir = PathBuf::from(&local).join("com.noteapp.desktop");
    let profile = app_dir.join("EBWebView");
    let mut out = format!(
        "LOCALAPPDATA: {local}\napp data dir: {}\nprofile dir : {}\n",
        app_dir.display(),
        profile.display()
    );
    for dir in [&app_dir, &profile] {
        match std::fs::create_dir_all(dir) {
            Ok(()) => {
                let probe = dir.join(".write-probe");
                match std::fs::write(&probe, b"ok") {
                    Ok(()) => {
                        let _ = std::fs::remove_file(&probe);
                        out.push_str(&format!("  writable  : {}\n", dir.display()));
                    }
                    Err(e) => out.push_str(&format!("  WRITE FAILED: {} -> {e}\n", dir.display())),
                }
            }
            Err(e) => out.push_str(&format!("  MKDIR FAILED: {} -> {e}\n", dir.display())),
        }
    }
    append_log(&out);
}

/// 安装 panic 钩子：把 panic 文本 + 回溯写进日志，让失败再也不会"看不见"。
fn install_panic_logger() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let backtrace = std::backtrace::Backtrace::force_capture();
        append_log(&format!(
            "!!! PANIC (epoch {secs}) !!!\n{info}\nbacktrace:\n{backtrace}\n"
        ));
        default_hook(info);
    }));
}

/// 注册全部存储命令（与 web 侧 StoragePort 一一对应）。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log_startup();
    install_panic_logger();
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
