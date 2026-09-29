import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `vite build --mode single` produces one self-contained HTML file (used for the shareable demo page).
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === "single" ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
  build: {
    outDir: mode === "single" ? "dist-single" : "dist",
    target: "es2022",
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: mode === "single" ? 100_000_000 : 4096,
  },
  server: { proxy: { "/api": "http://localhost:8787" } },
}));
