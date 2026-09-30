import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The public site. `--mode single` builds one self-contained HTML file (the shareable preview).
export default defineConfig(({ mode }) => ({
  plugins: mode === "single" ? [viteSingleFile({ removeViteModuleLoader: true })] : [],
  build: {
    outDir: mode === "single" ? "dist-single" : "dist",
    target: "es2022",
    chunkSizeWarningLimit: 4000,
    assetsInlineLimit: mode === "single" ? 100_000_000 : 4096,
  },
}));
