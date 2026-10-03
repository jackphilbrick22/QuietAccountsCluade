import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { PAGES, VIEWS } from "./src/trades.ts";
import { sitePages } from "./build/render.ts";
import { zipDist } from "./build/zip.ts";

// The public site: one HTML page per path (/ and /lawn/index.html, which Netlify serves at /lawn), built to dist/
// with dist.zip beside it for Netlify drag-and-drop. The pages' shared pieces and the engine's words go in at build.
// The violet views (main-site/, cold-email-page/) build beside them; the deploy zip's _redirects puts them at / and /lawn.
const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [sitePages(), zipDist()],
  build: {
    outDir: "dist",
    target: "es2022",
    rollupOptions: { input: { index: at("./index.html"), ...Object.fromEntries([...PAGES, ...VIEWS].map((p) => [p.id, at(`./${p.id}/index.html`)])) } },
  },
});
