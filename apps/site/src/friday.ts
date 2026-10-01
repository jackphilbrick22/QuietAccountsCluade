/**
 * The old site's example Friday text, which no page shows now: the same lines, in the same order, as the real one
 * (engine reports/owner.ts weeklyReport), numbers aside. It goes once the real one has the brief's words and /lawn
 * shows that instead. It has no quiet-rate line. The real one ("Quotes that went quiet: X% (was Y% before we
 * started)") only shows up once enough new quotes are two weeks old, and a before-and-after drop here would read as a
 * typical result.
 */
export function fridayExample(owner: string, won: string): string[] {
  return [
    `${owner}, 2 jobs came back this week — ${won}.`,
    "",
    "Notes out: 61 (to 38 people)",
    "Always on: answered 4 new requests, followed up 9 new quotes",
    "Wrote back: 7",
    "Asked to come back: 3",
    `Booked: 2 · ${won}`,
    "Your average time to call them back: 3h",
  ];
}
