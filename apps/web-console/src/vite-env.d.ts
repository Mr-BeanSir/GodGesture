/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 后端基址(留空则同源,走 vite dev 代理 / 反向代理的 /api) */
  readonly GODGESTURE_API?: string;
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
