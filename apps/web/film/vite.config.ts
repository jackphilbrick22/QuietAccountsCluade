import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * The service film's own page (apps/web/film): its own root and output, so the app's build is untouched.
 *   vite build --config film/vite.config.ts   → film/dist (served by film/render.mjs, never deployed)
 */
const root = decodeURIComponent(new URL(".", import.meta.url).pathname);
export default defineConfig({
  root,
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { outDir: `${root}dist`, emptyOutDir: true, target: "es2022", chunkSizeWarningLimit: 4000, assetsInlineLimit: 0 },
  // the trade pages' logo marks come from apps/site/src/assets (film/src/theme.ts)
  server: { port: 5190, strictPort: false, fs: { allow: [decodeURIComponent(new URL("../../..", import.meta.url).pathname)] } },
});
