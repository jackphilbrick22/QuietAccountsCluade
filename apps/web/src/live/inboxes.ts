/** A client's sending inboxes as typed in Settings: commas, semicolons or spaces between them, lowercased, each once. */
export function parseInboxes(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((x) => x.toLowerCase()).filter(Boolean))];
}

/**
 * What the inboxes field shows: the text as typed while it reads as the form's list, else the list itself (Discard put
 * the saved one back), so the screen never shows inboxes a save wouldn't send.
 */
export function inboxesText(typed: string, list: readonly string[]): string {
  return parseInboxes(typed).join(",") === list.join(",") ? typed : list.join(", ");
}
