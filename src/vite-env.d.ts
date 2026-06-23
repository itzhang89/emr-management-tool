/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_CHANNEL?: string;
  readonly VITE_APP_PLATFORM?: string;
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
