import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const devPort = Number(process.env.GODGESTURE_DEV_PORT || "14200");
// @ts-expect-error process is a nodejs global
const hmrPort = Number(process.env.GODGESTURE_HMR_PORT || "14201");

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue()],
  envPrefix: ["GODGESTURE_", "VITE_"],
  resolve: {
    // Consume the protocol source directly so Desktop dev cannot retain an optimized
    // packages/shared/dist bundle from before a schema edit.
    alias: {
      "@godgesture/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. Tauri and Vite share the port selected by the launcher; fail if a race takes it.
  server: {
    port: devPort,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: {
      protocol: "ws",
      host: host || "127.0.0.1",
      port: hmrPort,
    },
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
