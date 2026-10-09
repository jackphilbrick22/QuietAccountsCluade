/**
 * The film's look, per trade: the trade page's own colours, fonts and logo mark, so the console in the film looks like
 * the page it plays on. Chosen by the trade, the way the content is (data.ts reads ?trade=). Each theme maps the trade
 * page's tokens (apps/site/src: green.css for lawn, trade-<trade>.css for the others, both on top of soro.css) onto the
 * app's tokens (apps/web/src/styles.css), which were made from soro.css's by the same names:
 *
 *   site (soro.css)        app (styles.css)            site (soro.css)       app (styles.css)
 *   --ink, --ink-2         --ink, --ink-2              --violet              --accent
 *   --ink-3 ~ --ink-4      --ink-3 (between the two)   --violet-deep         --accent-deep
 *   --line, --line-2       --line, --line-2            --violet-link         --accent-ink
 *   --soft                 --sunken                    --lav-2               --accent-wash
 *   --soft-2               --surface-2                 --lav-line            --accent-line
 *   --grad, --shadow       --grad, --card-shadow       --lav-edge            --accent-edge (toward --lav-line)
 *
 * A trade page repurposes --lav as its highlight chip ("gold" on lawn, yellow on cleaning, peach on fence and tree), so
 * --accent-soft is drawn between --lav-2 and --lav-line instead. The canvas's two glows are the accent and the page's
 * --gold (harvest yellow, sunny yellow, sky blue, arborist orange): the colours the page puts beside its accent.
 */
import type { LucideIcon } from "lucide-react";
import { Fence, Sparkles, Sprout, TreePine } from "lucide-react";
import violetMark from "../../src/assets/logo-mark.svg";
import greenMark from "../../../site/src/assets/logo-mark-green.svg";
import aquaMark from "../../../site/src/assets/logo-mark-aqua.svg";
import cedarMark from "../../../site/src/assets/logo-mark-cedar.svg";
import treeMark from "../../../site/src/assets/logo-mark-tree.svg";

/** A trade page's tokens, as its CSS sets them (the ones the film uses). */
interface PageTokens {
  ink: string;
  ink2: string;
  ink3: string;
  ink4: string;
  line: string;
  line2: string;
  soft: string;
  soft2: string;
  violet: string;
  violetDeep: string;
  violetLink: string;
  lav2: string;
  lavLine: string;
  lavEdge: string;
  /** The page's highlight beside its accent (--gold). */
  gold: string;
  /** --shadow's colour, as r, g, b. */
  shadow: string;
}

export interface FilmTheme {
  /** The page it's taken from, for the record. */
  from: string;
  /** The app's tokens as this trade's page sets them: set on :root before the first frame. */
  vars: Record<string, string>;
  /** The canvas: its ground, its dot grid and its two static glows (r, g, b, alpha at the centre). */
  canvas: { base: string; dot: string; glowA: [string, number]; glowB: [string, number] };
  /** The window's hairline (a shade lighter than --line, so on a white page it draws no box). */
  hairline: string;
  /** Shadows' colour (r, g, b), for the window, a lifted row, a card, the phone. */
  shadow: string;
  /** The tabs: a quiet label and the active one. */
  tab: { quiet: string; active: string };
  /** The lifted row's tint while it's picked. */
  rowTint: string;
  /** The fonts: every face loaded before frame 0, and how the display face is set (its weight, width, tracking). */
  fonts: { load: string[]; display: string; body: string; heading?: string; css: string };
  /** The trade's logo mark (apps/site/src/assets/logo-mark-<colour>.svg). */
  mark: string;
  /** The icon beside "About their own job": the trade's own work. */
  workIcon: LucideIcon;
}

/* ------------------------------ colour arithmetic ------------------------------ */

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
/** a → b by k, as #rrggbb. */
export function mix(a: string, b: string, k: number): string {
  const [x, y] = [rgbOf(a), rgbOf(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * k).toString(16).padStart(2, "0")).join("")}`;
}
const rgb = (hex: string) => rgbOf(hex).join(", ");

/* ------------------------------ the fonts ------------------------------ */

/** His phone is his, not the trade page: its texts are always in Inter (the film's stand-in for the iPhone's face). */
export const PHONE_FONT = '"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif';
const PHONE_LOAD = ['400 14px "Inter"', '600 14px "Inter"'];

const INTER = {
  load: ['24px "Cal Sans"', '400 14px "Inter"', '500 14px "Inter"', '600 14px "Inter"', '700 14px "Inter"'],
  display: '"Cal Sans", "Inter", ui-sans-serif, system-ui, sans-serif',
  body: '"Inter", ui-sans-serif, system-ui, sans-serif',
  css: "",
};
/** green.css: wide, heavy Archivo headings (font-stretch 112–125 %, weight 750–800) over Archivo text. */
const ARCHIVO = {
  load: ['750 24px "Archivo"', '400 14px "Archivo"', '500 14px "Archivo"', '600 14px "Archivo"', '700 14px "Archivo"', ...PHONE_LOAD],
  display: '"Archivo", ui-sans-serif, system-ui, sans-serif',
  body: '"Archivo", ui-sans-serif, system-ui, sans-serif',
  css: `
    h1, h2, h3, .font-display { font-weight: 750; font-stretch: 112%; letter-spacing: -0.02em; word-spacing: normal; }
    h1 { font-weight: 780; font-stretch: 118%; }
  `,
};
/** trade-cleaning.css: Instrument Sans at weight 500 for headings and figures, Instrument Serif for section titles. */
const INSTRUMENT = {
  load: ['500 24px "Instrument Sans"', '400 14px "Instrument Sans"', '500 14px "Instrument Sans"', '600 14px "Instrument Sans"', '700 14px "Instrument Sans"', '24px "Instrument Serif"', ...PHONE_LOAD],
  display: '"Instrument Sans", ui-sans-serif, system-ui, sans-serif',
  body: '"Instrument Sans", ui-sans-serif, system-ui, sans-serif',
  heading: '"Instrument Serif", ui-serif, Georgia, serif',
  css: `
    h1, h3, .font-display { font-weight: 500; letter-spacing: -0.025em; word-spacing: normal; }
    h2 { font-family: "Instrument Serif", ui-serif, Georgia, serif; font-weight: 400; letter-spacing: -0.01em; word-spacing: normal; }
    .film-sep { word-spacing: 0.22em; }
  `,
};

/* ------------------------------ a page's tokens → the film's theme ------------------------------ */

function fromPage(from: string, t: PageTokens, fonts: FilmTheme["fonts"], mark: string, workIcon: LucideIcon): FilmTheme {
  const accent = t.violet;
  const vars: Record<string, string> = {
    "--ink": t.ink,
    "--ink-2": t.ink2,
    "--ink-3": mix(t.ink3, t.ink4, 0.5),
    "--line": t.line,
    "--line-2": t.line2,
    "--sunken": t.soft,
    "--surface-2": t.soft2,
    "--accent": accent,
    "--accent-deep": t.violetDeep,
    "--accent-ink": t.violetLink,
    "--accent-wash": t.lav2,
    "--accent-soft": mix(t.lav2, t.lavLine, 0.5),
    "--accent-line": t.lavLine,
    "--accent-edge": mix(t.lavLine, t.lavEdge, 0.35),
    "--grad": `linear-gradient(90deg, ${accent} 0%, ${accent} 100%)`,
    "--card-shadow": `0 30px 70px -40px rgba(${t.shadow}, 0.36), 0 2px 6px rgba(${t.shadow}, 0.05)`,
    "--lift-shadow": `0 40px 80px -40px rgba(${t.shadow}, 0.42), 0 2px 6px rgba(${t.shadow}, 0.06)`,
    "--soft-shadow": `0 10px 30px -18px rgba(${t.shadow}, 0.32)`,
    "--glow": `inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 14px 30px -12px rgba(${rgb(accent)}, 0.6)`,
    "--glow-sm": `inset 0 1px 0 rgba(255, 255, 255, 0.25), 0 8px 18px -10px rgba(${rgb(accent)}, 0.55)`,
    // the info status (a note "Scheduled") in the page's own accent, on its wash: the app's blue-violet is in no
    // trade page's palette. Done and going (Sent, Sending, Wants it done) keep the app's green: a status, not a look
    "--info": t.violetLink,
    "--info-soft": mix(t.lav2, t.lavLine, 0.6),
    "--font-display": fonts.display,
    "--font-body": fonts.body,
  };
  return {
    from,
    vars,
    canvas: { base: mix(t.soft, "#ffffff", 0.15), dot: mix(t.line2, t.line, 0.35), glowA: [rgb(accent), 0.13], glowB: [rgb(t.gold), 0.11] },
    hairline: mix(t.line, "#ffffff", 0.45),
    shadow: t.shadow,
    tab: { quiet: mix(t.ink3, t.ink4, 0.5), active: t.violetLink },
    rowTint: t.lav2,
    fonts,
    mark,
    workIcon,
  };
}

/** The violet app's own look (the site's soro.css): any trade without a page of its own. */
const VIOLET: FilmTheme = {
  from: "apps/web/src/styles.css (soro.css)",
  vars: {},
  canvas: { base: "#F8F8FB", dot: "#E5E4EE", glowA: ["122, 92, 255", 0.2], glowB: ["62, 107, 240", 0.08] },
  hairline: "#F3F2F7",
  shadow: "70, 40, 170",
  tab: { quiet: "#62626c", active: "#4128c9" },
  rowTint: "#f7f5ff",
  fonts: INTER,
  mark: violetMark,
  workIcon: Sprout,
};

export const THEMES: Record<string, FilmTheme> = {
  // green.css: field green, harvest yellow
  lawn: fromPage(
    "apps/site/src/green.css",
    { ink: "#0E1D13", ink2: "#33453A", ink3: "#4A5D50", ink4: "#56695C", line: "#E2EBE3", line2: "#D6E3D8", soft: "#F6FAF5", soft2: "#EDF4EE", violet: "#1B5A31", violetDeep: "#123F22", violetLink: "#1B5A31", lav2: "#F3F9F3", lavLine: "#DCEBDE", lavEdge: "#3E9A57", gold: "#FFD23F", shadow: "18, 63, 34" },
    ARCHIVO,
    greenMark,
    Sprout,
  ),
  // trade-cleaning.css: deep teal on pale aqua, sunny yellow
  cleaning: fromPage(
    "apps/site/src/trade-cleaning.css",
    { ink: "#0B2224", ink2: "#28403F", ink3: "#355052", ink4: "#45605F", line: "#DCEDEC", line2: "#CCE3E2", soft: "#F2FAFA", soft2: "#E5F4F5", violet: "#075156", violetDeep: "#04383C", violetLink: "#075156", lav2: "#F2FAFA", lavLine: "#D3ECEB", lavEdge: "#3BB7AE", gold: "#FEC827", shadow: "4, 56, 60" },
    INSTRUMENT,
    aquaMark,
    Sparkles,
  ),
  // trade-fence.css: cedar, the clear sky over it
  fence: fromPage(
    "apps/site/src/trade-fence.css",
    { ink: "#24160E", ink2: "#4A3428", ink3: "#5C4535", ink4: "#6A5242", line: "#EEE4DB", line2: "#E3D6CA", soft: "#FBF7F3", soft2: "#F4ECE4", violet: "#7A4423", violetDeep: "#5A2F15", violetLink: "#7A4423", lav2: "#FBF5EF", lavLine: "#EDDCCB", lavEdge: "#B97A4E", gold: "#8FD0FF", shadow: "60, 28, 10" },
    ARCHIVO,
    cedarMark,
    Fence,
  ),
  // trade-tree.css: deep conifer green, arborist orange
  tree: fromPage(
    "apps/site/src/trade-tree.css",
    { ink: "#10221A", ink2: "#2F4337", ink3: "#465A4E", ink4: "#526659", line: "#E0E8E2", line2: "#D2DED5", soft: "#F5F8F5", soft2: "#EBF1EC", violet: "#1E4D33", violetDeep: "#12331F", violetLink: "#1E4D33", lav2: "#F3F8F4", lavLine: "#DBE7DE", lavEdge: "#3F8A5E", gold: "#FF8A2A", shadow: "12, 40, 24" },
    ARCHIVO,
    treeMark,
    // a pine reads as a tree at chip size (the deciduous one reads as a bell)
    TreePine,
  ),
};

export function themeFor(trade: string): FilmTheme {
  return THEMES[trade] ?? VIOLET;
}

/** Put a theme on the page: the app's tokens on :root, and its fonts' settings. */
export function applyTheme(th: FilmTheme): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(th.vars)) root.style.setProperty(k, v);
  const style = document.createElement("style");
  style.dataset.filmTheme = "";
  style.textContent = th.fonts.css;
  document.head.appendChild(style);
}
