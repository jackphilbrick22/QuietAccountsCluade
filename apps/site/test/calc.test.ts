import { describe, expect, it } from "vitest";
import { percent, sums } from "../src/calc.ts";

/** The calculator's sums, which the build writes into the page and the page redoes as he slides. */
describe("the calculator", () => {
  const nelson = { booked: 4, asked: 150 };
  const pay = { each: 250, cap: 4 };

  it("books his count at the lead shop's rate, shown to a tenth of a percent under 10%", () => {
    expect(sums(300, 650, { booked: 17, asked: 150 })).toEqual({ rate: "11%", jobs: 34, value: 22_100 });
    expect(sums(600, 2650, nelson).rate).toBe("2.7%");
    expect([percent(2.666), percent(9.96), percent(11.33)]).toEqual(["2.7%", "10%", "11%"]);
  });

  it("on a one pass, he'd pay $250 a job, never more than four of them, and the share of the money that is", () => {
    // 600 old quotes: 16 jobs, $42,400; he pays the $1,000 cap, 2.4% of it
    expect(sums(600, 2650, nelson, pay)).toEqual({ rate: "2.7%", jobs: 16, value: 42_400, pay: 1000, share: "2.4%" });
    // under the cap, each job is $250: 80 quotes is 2 jobs, $500 of $6,200
    expect(sums(80, 3100, nelson, pay)).toMatchObject({ jobs: 2, pay: 500, share: "8.1%" });
    // exactly four is the cap, and a fifth costs nothing more
    expect(sums(150, 2000, nelson, pay).pay).toBe(1000);
    expect(sums(190, 2000, nelson, pay)).toMatchObject({ jobs: 5, pay: 1000 });
  });
});
