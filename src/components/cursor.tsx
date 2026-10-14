"use client";

/**
 * The studio's own pointer: an arrow, a pointing hand over anything you can
 * press, and an I-beam over text, behaving the way an Apple pointer does.
 *
 *   - The tip is exactly where the mouse is, every frame. Nothing about the
 *     POSITION is smoothed: a pointer that trails the hand feels broken.
 *   - Shape changes are springs: the hand pops in at 88% and settles, a press
 *     dips to 90%, release springs back.
 *   - Magnetism (iPadOS): over a small control the pointer is drawn a few
 *     pixels toward its centre, and the control leans back toward the
 *     pointer and lifts, so it feels picked up. Uses the CSS `translate`
 *     property, which composes with any `transform` the control already has.
 *   - It hides when the mouse leaves the window, and gets out of the way for
 *     touch and pen: those devices keep their own behaviour.
 *   - Reduced motion: same shapes, no springs, no magnetism, no lift.
 *
 * The system cursor is hidden only while this is running (`html.hu-cursor`),
 * and globals.css sets the same artwork as plain CSS cursors, so the look is
 * right before hydration and for anyone without JavaScript.
 */
import { useEffect, useRef } from "react";

type Shape = "arrow" | "hand" | "text";

/** Things you can press. The hand. */
const PRESSABLE = [
  "a[href]", "button:not(:disabled)", "summary", "select:not(:disabled)", "label[for]", "label:has(input)",
  '[role="button"]', '[role="menuitem"]', '[role="menuitemradio"]', '[role="tab"]', '[role="radio"]', '[role="switch"]', '[role="option"]', '[role="checkbox"]',
  'input[type="checkbox"]:not(:disabled)', 'input[type="radio"]:not(:disabled)', 'input[type="range"]:not(:disabled)', 'input[type="color"]', 'input[type="file"]',
  ".hu-card--interactive", "[draggable='true']", '[data-cursor="hand"]',
].join(",");
/** Things you type in. The I-beam. */
const TYPABLE = [
  'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):not([type="submit"]):not([type="button"]):not(:disabled)',
  "textarea:not(:disabled)", '[contenteditable="true"]', '[role="textbox"]', '[data-cursor="text"]',
].join(",");
/** Small enough to be magnetic. Big cards and wide menu rows are not. */
const MAGNET_MAX = 72;

function shapeAt(el: Element | null): { shape: Shape; target: HTMLElement | null; grab: boolean } {
  if (!el) return { shape: "arrow", target: null, grab: false };
  // An explicit opt-out wins: a canvas that pans with the hand tool, say.
  const forced = el.closest<HTMLElement>("[data-cursor]");
  const typed = el.closest<HTMLElement>(TYPABLE);
  const pressed = el.closest<HTMLElement>(PRESSABLE);
  // Inline grab / grabbing (the canvas sets it while panning) reads through even
  // though the stylesheet hides the system cursor: it's on the element's style.
  const grabEl = el.closest<HTMLElement>('[style*="cursor: grab"]');
  if (forced?.dataset.cursor === "arrow") return { shape: "arrow", target: null, grab: false };
  if (grabEl) return { shape: "hand", target: null, grab: true };
  // The nearer of the two decides: a button inside a text field's row is a button.
  if (typed && (!pressed || pressed.contains(typed))) return { shape: "text", target: typed, grab: false };
  if (pressed) return { shape: "hand", target: pressed, grab: false };
  return { shape: "arrow", target: null, grab: false };
}

const HOTSPOT: Record<Shape, [number, number]> = { arrow: [5.8, 3.3], hand: [12.2, 2.4], text: [14, 14] };
const SIZE = 28;

export function StudioCursor() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!fine.matches || !root.current) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const node = root.current;
    const html = document.documentElement;

    let x = -100, y = -100;
    let shape: Shape = "arrow";
    let visible = false;
    let down = false;
    let scale = 1, scaleV = 0, scaleTo = 1;
    let mx = 0, my = 0, mxTo = 0, myTo = 0;
    let lifted: HTMLElement | null = null;
    let raf = 0;
    let last = performance.now();

    const setShape = (next: Shape, grab: boolean) => {
      node.dataset.grab = grab ? (down ? "closed" : "open") : "";
      if (next === shape) return;
      shape = next;
      node.dataset.shape = next;
      // The new shape pops in slightly small, then the spring settles it.
      if (!reduce.matches) scale = next === "arrow" ? 0.94 : 0.86;
    };

    const unlift = () => {
      if (!lifted) return;
      const el = lifted;
      lifted = null;
      const from = el.style.translate || "0px 0px";
      el.style.translate = "";
      el.classList.remove("hu-lifted");
      // Settle back rather than snap. Web Animations, so the control's own
      // CSS transitions (colour, press scale) are left exactly as they are.
      if (!reduce.matches && from !== "0px 0px") el.animate([{ translate: from }, { translate: "0px 0px" }], { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    };

    const place = () => {
      const [hx, hy] = HOTSPOT[shape];
      node.style.transform = `translate3d(${x + mx - hx}px, ${y + my - hy}px, 0) scale(${scale.toFixed(4)})`;
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Critically-damped-ish spring for scale; magnetism eases.
      const k = 520, d = 34;
      scaleV += (k * (scaleTo - scale) - d * scaleV) * dt;
      scale += scaleV * dt;
      const e = 1 - Math.pow(0.0008, dt);
      mx += (mxTo - mx) * e;
      my += (myTo - my) * e;
      place();
      const settled = Math.abs(scaleTo - scale) < 0.001 && Math.abs(scaleV) < 0.01 && Math.abs(mxTo - mx) < 0.05 && Math.abs(myTo - my) < 0.05;
      raf = settled ? 0 : requestAnimationFrame(tick);
    };
    const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };

    const show = (on: boolean) => {
      if (on === visible) return;
      visible = on;
      node.dataset.visible = on ? "1" : "";
      html.classList.toggle("hu-cursor", on);
      if (!on) unlift();
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType !== "mouse") { show(false); return; }
      x = ev.clientX;
      y = ev.clientY;
      show(true);
      const { shape: next, target, grab } = shapeAt(ev.target as Element);
      setShape(next, grab);
      scaleTo = down ? 0.9 : 1;

      // Magnetism and lift: small pressable controls only, and not while dragging.
      const r = target && next === "hand" && !down && !reduce.matches ? target.getBoundingClientRect() : null;
      const magnetic = r && r.width <= MAGNET_MAX * 2.5 && r.height <= MAGNET_MAX;
      if (magnetic && r) {
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const dx = cx - x, dy = cy - y;
        mxTo = Math.max(-5, Math.min(5, dx * 0.16));
        myTo = Math.max(-5, Math.min(5, dy * 0.16));
        if (lifted !== target) { unlift(); lifted = target; target!.classList.add("hu-lifted"); }
        // The control leans back toward the pointer: a fraction of a pixel per pixel, capped.
        target!.style.translate = `${Math.max(-2.5, Math.min(2.5, -dx * 0.06)).toFixed(2)}px ${Math.max(-2, Math.min(2, -dy * 0.08)).toFixed(2)}px`;
      } else {
        mxTo = 0; myTo = 0;
        if (lifted && lifted !== target) unlift();
        if (!magnetic) unlift();
      }
      // Position is applied now, in the event, so the tip never lags a frame.
      place();
      wake();
    };
    const onDown = (ev: PointerEvent) => {
      if (ev.pointerType !== "mouse") return;
      down = true;
      scaleTo = reduce.matches ? 1 : 0.9;
      if (node.dataset.grab) node.dataset.grab = "closed";
      wake();
    };
    const onUp = () => { down = false; scaleTo = 1; if (node.dataset.grab) node.dataset.grab = "open"; wake(); };
    const onLeave = (ev: MouseEvent) => { if (!ev.relatedTarget) show(false); };
    const onTouch = () => show(false);
    const onScroll = () => { mxTo = 0; myTo = 0; unlift(); };

    node.dataset.shape = shape;
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.addEventListener("mouseout", onLeave);
    window.addEventListener("touchstart", onTouch, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("blur", () => show(false));
    return () => {
      cancelAnimationFrame(raf);
      unlift();
      html.classList.remove("hu-cursor");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("mouseout", onLeave);
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  return (
    <div ref={root} aria-hidden="true" className="hu-pointer" style={{ width: SIZE, height: SIZE }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static art, sized in CSS, never optimised */}
      <img src="/cursors/arrow.svg" alt="" width={SIZE} height={SIZE} draggable={false} className="hu-pointer__arrow" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/cursors/hand.svg" alt="" width={SIZE} height={SIZE} draggable={false} className="hu-pointer__hand" />
      <span className="hu-pointer__text" />
    </div>
  );
}
