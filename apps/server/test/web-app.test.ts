import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mountWeb, WEB_ROOT_FILES } from "../src/main.ts";

const dist = mkdtempSync(join(tmpdir(), "qa-web-"));
mkdirSync(join(dist, "assets"));
writeFileSync(join(dist, "index.html"), "<!doctype html><title>Quiet Accounts App</title>");
writeFileSync(join(dist, "assets", "app.js"), "console.log(1)");
for (const f of WEB_ROOT_FILES) writeFileSync(join(dist, f), f.endsWith(".webmanifest") ? '{"name":"Quiet Accounts"}' : "x");
const app = new Hono();
mountWeb(app as never, dist);
afterAll(() => rmSync(dist, { recursive: true, force: true }));

describe("the web app on the server", () => {
  it("serves what a phone needs to add it to the home screen, with the manifest's own type", async () => {
    const m = await app.request("/manifest.webmanifest");
    expect(m.status).toBe(200);
    expect(m.headers.get("content-type")).toMatch(/application\/manifest\+json/);
    for (const f of ["apple-touch-icon.png", "icon-192.png", "icon-512.png", "logo-mark.svg"]) expect((await app.request(`/${f}`)).status, f).toBe(200);
  });

  it("serves its assets and index.html for every page, but never for the API or webhooks", async () => {
    expect((await app.request("/assets/app.js")).status).toBe(200);
    expect(await (await app.request("/clients")).text()).toContain("Quiet Accounts App");
    expect((await app.request("/api/nope")).status).toBe(404);
    expect((await app.request("/webhooks/nope")).status).toBe(404);
  });

  it("the built app's index.html points a phone at the manifest and the home-screen icon, and the manifest opens the live console", () => {
    const web = resolve(import.meta.dirname, "../../web");
    const html = readFileSync(join(web, "index.html"), "utf8");
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    const manifest = JSON.parse(readFileSync(join(web, "public", "manifest.webmanifest"), "utf8"));
    expect(manifest).toMatchObject({ name: "Quiet Accounts", start_url: "/#live", display: "standalone" });
    for (const i of manifest.icons as { src: string }[]) expect(WEB_ROOT_FILES).toContain(i.src.replace(/^\//, ""));
  });
});
