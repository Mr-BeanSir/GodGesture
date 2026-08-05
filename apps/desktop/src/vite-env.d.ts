/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly GODGESTURE_API?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_GESTURE_TEMPLATE_CATALOG_URL?: string;
  readonly VITE_GESTURE_TEMPLATE_REPOSITORY_URL?: string;
  readonly VITE_GODGESTURE_REPOSITORY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
