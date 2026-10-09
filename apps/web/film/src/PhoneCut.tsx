/**
 * The phone cut (camera.ts): the film, framed by a camera that follows what acts, in a square for a phone's screen.
 * Its edges melt into the page's white on all four sides (the camera's frame cuts through the window and the canvas,
 * and a hard edge would draw a box on the page), and its outer 14 px are pure white, as the film's are.
 */
import { CUT, EDGE, camera } from "./camera";
import { Film } from "./Film";

export function PhoneCut({ t }: { t: number }) {
  const c = camera(t);
  const tx = CUT.w / 2 - c.cx * c.z;
  const ty = CUT.h / 2 - c.cy * c.z;
  const edge = (to: string, fade: number) => `linear-gradient(to ${to}, #ffffff 0px, #ffffff ${EDGE.solid}px, rgba(255,255,255,0.7) ${EDGE.solid + (fade - EDGE.solid) * 0.3}px, rgba(255,255,255,0) ${fade}px)`;
  return (
    <div className="relative overflow-hidden bg-white" style={{ width: CUT.w, height: CUT.h }}>
      <div className="absolute top-0 left-0" style={{ width: 1280, height: 596, transformOrigin: "0 0", transform: `translate(${tx.toFixed(3)}px, ${ty.toFixed(3)}px) scale(${c.z.toFixed(5)})` }}>
        <Film t={t} />
      </div>
      <div className="pointer-events-none absolute inset-0" style={{ zIndex: 200, backgroundImage: [edge("right", EDGE.side), edge("left", EDGE.side), edge("bottom", EDGE.top), edge("top", EDGE.top)].join(", ") }} />
    </div>
  );
}
