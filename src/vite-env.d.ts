/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_CHANNEL?: string;
  readonly VITE_APP_PLATFORM?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_APP_DISTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
