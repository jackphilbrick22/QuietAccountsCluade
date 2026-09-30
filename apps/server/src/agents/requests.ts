import { z } from "zod";
import type { RequestEmail } from "@qa/engine";
import type { Llm } from "./llm.ts";

const LeadSchema = z.object({
  isRequest: z.boolean().describe("true only if a homeowner or property manager is asking this company for work, a visit or a price"),
  name: z.string().nullable(),
  email: z.string().nullable().describe("The person's own email, exactly as written. Never the platform's or the company's address. null if absent."),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  job: z.string().nullable().describe("What they want done, in their words, under 200 characters"),
  source: z.string().describe('Where the request came from: "Angi", "Thumbtack", "Google", "Yelp", "your website", or "a forwarded email"'),
});

const SYSTEM = `A small home-service company (tree, fence, painting, cleaning, lawn...) forwarded an email to us. Our rules couldn't read it.
Decide whether it's a new request for work from a customer (a website form, a lead alert from Angi/Thumbtack/Google/Yelp, or a homeowner's own email) and pull out the person's details.
Copy details exactly as they appear. Never invent or complete an email address or phone number. If the platform hides the customer's contact (answer-in-app), leave email and phone null.`;

/** A second read of a forwarded request the rules couldn't place. Only ever fills what's written in the email. */
export async function readRequestWithClaude(llm: Llm, input: { subject: string; text: string; businessName: string }): Promise<RequestEmail | null> {
  const out = await llm.structured(LeadSchema, {
    purpose: "inbox.request",
    effort: "low",
    maxTokens: 1024,
    system: SYSTEM,
    user: `COMPANY: ${input.businessName}\nSUBJECT: ${input.subject}\n\nEMAIL:\n"""\n${input.text.slice(0, 6000)}\n"""`,
  });
  if (!out?.isRequest) return null;
  // what Claude read has to be in the email word for word
  const inText = (x: string | null) => (x && input.text.toLowerCase().includes(x.toLowerCase().trim()) ? x.trim() : undefined);
  const email = inText(out.email);
  const phone = out.phone && input.text.replace(/\D/g, "").includes(out.phone.replace(/\D/g, "").slice(-10)) ? out.phone : undefined;
  if (!email && !phone) return null;
  return { name: out.name ?? undefined, email: email?.toLowerCase(), phone, address: out.address ?? undefined, job: out.job ?? undefined, source: out.source || "a forwarded email", read: "loose" };
}
