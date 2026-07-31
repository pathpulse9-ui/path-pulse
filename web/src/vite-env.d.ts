/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  /** Dev-only ops passcode (Phase 1 scaffold — replaced by backend auth later). */
  readonly VITE_OPS_DEV_PASSCODE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
