import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

/**
 * Thin wrapper over Claude for the three places the system uses judgment:
 * reading ambiguous replies, personalizing notes, and mapping odd spreadsheet columns.
 * Every call returns validated structured output or `null` — callers always have a
 * deterministic fallback, so the system keeps running with no API key at all.
 *
 * Refusal fallback: requests opt into server-side fallbacks ("default") so a declined
 * request is retried on Anthropic's recommended model instead of failing.
 */
export interface LlmCallOptions {
  system: string;
  user: string;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
  /** Label for logs/metrics. */
  purpose: string;
}

export interface Llm {
  structured<S extends z.ZodType>(schema: S, opts: LlmCallOptions): Promise<z.infer<S> | null>;
  readonly model: string;
}

export function createLlm(cfg: { apiKey?: string; model: string; log?: (msg: string) => void }): Llm | null {
  if (!cfg.apiKey) return null;
  const client = new Anthropic({ apiKey: cfg.apiKey, maxRetries: 2, timeout: 60_000 });
  const log = cfg.log ?? (() => {});
  return {
    model: cfg.model,
    async structured(schema, opts) {
      try {
        const res = await client.beta.messages.parse({
          model: cfg.model,
          max_tokens: opts.maxTokens ?? 2048,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: opts.effort ?? "low", format: zodOutputFormat(schema) },
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
        });
        if (res.stop_reason === "refusal") {
          log(`[llm] ${opts.purpose}: declined (${res.stop_details?.category ?? "no category"})`);
          return null;
        }
        if (res.stop_reason === "max_tokens") {
          log(`[llm] ${opts.purpose}: hit max_tokens`);
          return null;
        }
        return (res.parsed_output ?? null) as z.infer<typeof schema> | null;
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError) log(`[llm] ${opts.purpose}: rate limited`);
        else if (e instanceof Anthropic.APIError) log(`[llm] ${opts.purpose}: API error ${e.status} ${e.message}`);
        else log(`[llm] ${opts.purpose}: ${(e as Error).message}`);
        return null;
      }
    },
  };
}
