// storage-info.ts —— 存储信息契约与归一化（Rust 侧字段兼容 camelCase / snake_case）
export interface StorageInfo {
  appVersion: string;
  /** 应用配置目录（settings.json / storage.json 所在） */
  dataDir: string;
  /** 当前笔记目录（含 meta.json） */
  notesDir: string;
  /** 默认笔记目录（自定义前的位置） */
  defaultNotesDir: string;
  settingsFile: string;
  /** 是否已自定义存储位置 */
  isCustom: boolean;
}

type Raw = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 把后端返回的存储信息归一化为前端契约（兼容 snake_case 历史字段） */
export function normalizeStorageInfo(raw: unknown): StorageInfo {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Raw;
  return {
    appVersion: str(o.appVersion ?? o.app_version),
    dataDir: str(o.dataDir ?? o.data_dir),
    notesDir: str(o.notesDir ?? o.notes_dir),
    defaultNotesDir: str(o.defaultNotesDir ?? o.default_notes_dir),
    settingsFile: str(o.settingsFile ?? o.settings_file),
    isCustom: (o.isCustom ?? o.is_custom) === true,
  };
}
