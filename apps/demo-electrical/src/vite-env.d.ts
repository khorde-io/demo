/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `mock` runs the plant simulator in the browser; anything else uses config.json. */
  readonly VITE_HMI_BACKEND?: string;
  /** Where to load the runtime config from (default `/config.json`). */
  readonly VITE_HMI_CONFIG?: string;
}
