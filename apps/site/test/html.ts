import { readFileSync } from "node:fs";
import { renderPage } from "../build/render.ts";
import { PAGES, type SitePage } from "../src/trades.ts";

/** The pages as the build writes them (markers filled), and plain-text views of them for the word rules. */
export const page = (id: string) => PAGES.find((p) => p.id === id)!;
export const lawn = page("lawn");

export function rendered(file: string, page?: SitePage): string {
  return renderPage(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), page);
}

export function unescape(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|middot|rarr|ndash);/g, (_m, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", middot: "·", rarr: "→", ndash: "–" })[e]!);
}

/** What a visitor can read: no head (but its description), no scripts, no hidden Netlify copy, tags dropped. */
export function visibleText(html: string): string {
  const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "";
  const body = html
    .replace(/<head>[\s\S]*?<\/head>/, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<form name="start"[\s\S]*?<\/form>/, "")
    .replace(/<[^>]+>/g, " ");
  return unescape(`${description} ${body}`).replace(/\s+/g, " ").trim();
}

/** Every element of a kind, from its opening tag to its matching close (no nesting of the same tag inside). */
export function blocks(html: string, open: RegExp, tag: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(new RegExp(open.source, "g"))) out.push(html.slice(m.index, html.indexOf(`</${tag}>`, m.index) + tag.length + 3));
  return out;
}

export const textOf = (html: string) => unescape(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
