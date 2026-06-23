import { readFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const appVersion = JSON.parse(readFileSync("./package.json", "utf8")).version as string;
process.env.VITE_APP_VERSION ??= appVersion;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  clearScreen: false,
  server: {
    strictPort: true,
    port: 1420
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    chunkSizeWarningLimit: 750
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
    css: true
  }
});
