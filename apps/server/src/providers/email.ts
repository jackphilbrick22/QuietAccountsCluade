import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type { DirectProvider, OutboundMessage, SendResult } from "../contracts.ts";
import { ProviderError } from "../contracts.ts";

/** Writes every note to memory (and the log) instead of sending. Dev, tests and dry runs. */
export class LogEmailProvider implements DirectProvider {
  readonly kind = "direct" as const;
  readonly name = "log";
  readonly sent: (OutboundMessage & SendResult)[] = [];
  constructor(private opts: { quiet?: boolean; failFor?: (m: OutboundMessage) => Error | undefined } = {}) {}
  async send(msg: OutboundMessage): Promise<SendResult> {
    const fail = this.opts.failFor?.(msg);
    if (fail) throw fail;
    const providerId = `log-${randomUUID()}`;
    const out = { ...msg, providerId, messageId: `<${providerId}@quiet-accounts.local>` };
    this.sent.push(out);
    if (!this.opts.quiet) console.log(`[email:log] → ${msg.to} · ${msg.subject}`);
    return { providerId, messageId: out.messageId };
  }
}

/**
 * Plain-text SMTP sending (Google Workspace, Microsoft 365, Postmark, SES...).
 * Sets the headers Gmail/Yahoo require of bulk senders: List-Unsubscribe with a one-click URL
 * (RFC 8058) plus mailto, and threads follow-ups with In-Reply-To/References.
 */
export class SmtpEmailProvider implements DirectProvider {
  readonly kind = "direct" as const;
  readonly name = "smtp";
  private transport: nodemailer.Transporter;
  constructor(
    url: string,
    private defaults: { from?: string } = {},
  ) {
    this.transport = nodemailer.createTransport(url);
  }

  async send(msg: OutboundMessage): Promise<SendResult> {
    const fromAddr = msg.fromEmail ?? this.defaults.from;
    if (!fromAddr) throw new ProviderError("No From address configured (SMTP_FROM or business sending address)", "smtp");
    const headers: Record<string, string> = {};
    if (msg.unsubscribeUrl) {
      const mailto = msg.replyTo ?? fromAddr;
      headers["List-Unsubscribe"] = `<${msg.unsubscribeUrl}>, <mailto:${mailto}?subject=unsubscribe>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    try {
      const info = await this.transport.sendMail({
        from: { name: msg.fromName, address: fromAddr },
        to: { name: msg.toName, address: msg.to },
        replyTo: msg.replyTo,
        subject: msg.subject,
        text: msg.text,
        inReplyTo: msg.inReplyTo,
        references: msg.references,
        headers,
      });
      return { providerId: info.messageId, messageId: info.messageId };
    } catch (e) {
      const err = e as { responseCode?: number; message?: string };
      const code = err.responseCode ?? 0;
      // 4xx SMTP replies are temporary; 5xx are permanent (bad address, policy block)
      throw new ProviderError(err.message ?? "SMTP send failed", "smtp", code, code === 0 || (code >= 400 && code < 500));
    }
  }
}
