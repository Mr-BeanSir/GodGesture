import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

const backendPort = Number(process.env.GODGESTURE_SERVER_PORT || "3000");
const frontendPort = Number(process.env.GODGESTURE_WEB_PORT || "5180");

export default defineConfig({
  plugins: [vue()],
  envPrefix: ["GODGESTURE_", "VITE_"],
  server: {
    host: "127.0.0.1",
    port: frontendPort,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
