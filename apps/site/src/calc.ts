/**
 * The calculator's sums, the same at build time (what shows before any script runs) and in the browser: his count at
 * the lead shop's own rate, times his average job, and on a one pass what he'd pay for those jobs, capped.
 */
export interface Sums {
  /** The lead shop's rate: "11%", "2.7%". */
  rate: string;
  jobs: number;
  value: number;
  /** One pass only: what he'd pay, and that as a share of the value. */
  pay?: number;
  share?: string;
}

/** A whole percent, or one decimal under 10% (Nelson Fence's 4 of 150 is 2.7%, not 3%). */
export const percent = (x: number) => `${x < 10 ? Math.round(x * 10) / 10 : Math.round(x)}%`;
export const whole = (x: number) => Math.round(x).toLocaleString("en-US");

export function sums(count: number, job: number, lead: { booked: number; asked: number }, pay?: { each: number; cap: number }): Sums {
  const jobs = Math.round((count * lead.booked) / lead.asked);
  const value = jobs * job;
  const out: Sums = { rate: percent((lead.booked / lead.asked) * 100), jobs, value };
  if (pay) {
    out.pay = Math.min(jobs, pay.cap) * pay.each;
    out.share = percent((out.pay / value) * 100);
  }
  return out;
}
