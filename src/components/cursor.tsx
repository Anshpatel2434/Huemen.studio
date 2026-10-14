"use client";

/**
 * The studio's own pointer: an arrow, a pointing hand over anything you can
 * press, and an I-beam over text, behaving the way an Apple pointer does.
 *
 *   - The tip is exactly where the mouse is, every frame. Nothing about the
 *     POSITION is smoothed: a pointer that trails the hand feels broken.
 *   - Shape changes settle in, a press dips to 94%, release springs back.
 *   - Nothing on the page moves under it: no magnetism, no lean, no lift.
 *   - It hides when the mouse leaves the window, and gets out of the way for
 *     touch and pen: those devices keep their own behaviour.
 *   - Reduced motion: same shapes, no springs.
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
    const mx = 0, my = 0;
    let raf = 0;
    let last = performance.now();

    const setShape = (next: Shape, grab: boolean) => {
      node.dataset.grab = grab ? (down ? "closed" : "open") : "";
      if (next === shape) return;
      shape = next;
      node.dataset.shape = next;
      // The new shape pops in slightly small, then the spring settles it.
      if (!reduce.matches) scale = 0.96;
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
      place();
      const settled = Math.abs(scaleTo - scale) < 0.001 && Math.abs(scaleV) < 0.01;
      raf = settled ? 0 : requestAnimationFrame(tick);
    };
    const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } };

    const show = (on: boolean) => {
      if (on === visible) return;
      visible = on;
      node.dataset.visible = on ? "1" : "";
      html.classList.toggle("hu-cursor", on);
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType !== "mouse") { show(false); return; }
      x = ev.clientX;
      y = ev.clientY;
      show(true);
      const { shape: next, grab } = shapeAt(ev.target as Element);
      setShape(next, grab);
      scaleTo = down ? 0.94 : 1;

      // No magnetism and no lean: nothing on the page moves under the pointer,
      // and the pointer never drifts from the mouse. (Client direction, 14 Oct:
      // the lean read as a jiggle on every hover.)
      // Position is applied now, in the event, so the tip never lags a frame.
      place();
      wake();
    };
    const onDown = (ev: PointerEvent) => {
      if (ev.pointerType !== "mouse") return;
      down = true;
      scaleTo = reduce.matches ? 1 : 0.94;
      if (node.dataset.grab) node.dataset.grab = "closed";
      wake();
    };
    const onUp = () => { down = false; scaleTo = 1; if (node.dataset.grab) node.dataset.grab = "open"; wake(); };
    const onLeave = (ev: MouseEvent) => { if (!ev.relatedTarget) show(false); };
    const onTouch = () => show(false);

    node.dataset.shape = shape;
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.addEventListener("mouseout", onLeave);
    window.addEventListener("touchstart", onTouch, { passive: true });
    window.addEventListener("blur", () => show(false));
    return () => {
      cancelAnimationFrame(raf);
      html.classList.remove("hu-cursor");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("mouseout", onLeave);
      window.removeEventListener("touchstart", onTouch);
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
