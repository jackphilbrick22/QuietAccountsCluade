/**
 * The page's note is the engine's own, written at build time with {company} and {signer} left open (build/examples.ts);
 * so is the consent line's {company}. This fills them in as the owner types, with the engine's one tidy-up that a name
 * can trigger: "Co." before a full stop stays "Co.", never "Co..". A test holds it to the engine's own output.
 */
export function fillIn(template: string, company: string, signer: string): string {
  return template.replace(/\{(company|signer)\}/g, (_m, k: string) => (k === "company" ? company : signer)).replace(/([^.])\.\.(?!\.)/g, "$1.");
}
