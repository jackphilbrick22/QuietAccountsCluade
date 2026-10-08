/**
 * Which side acts (STORYBOARD §3). While the phone is on screen there are two places to look, so they take turns: the
 * side that acts is at full strength and leads; the other holds still and recedes a little (`IDLE`). Each switch
 * eases over 300 ms.
 */
import { lerp, prog, sine } from "./motion";
import { FOCUS, IDLE } from "./timeline";

export function dim(t: number, side: "console" | "phone"): number {
  let level = FOCUS[0]!.to === side ? 1 : IDLE;
  for (let i = 1; i < FOCUS.length; i++) {
    const f = FOCUS[i]!;
    if (t < f.at) break;
    level = lerp(level, f.to === side ? 1 : IDLE, sine(prog(t, f.at, 300)));
  }
  return level;
}
