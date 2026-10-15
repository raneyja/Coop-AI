import assert from "node:assert/strict";
import test from "node:test";
import { observePaintedAnswer } from "./answerPaintObservation";

test("actual observer owner waits for two frames and rejects hidden, heading-only, offscreen and disposed bodies", () => {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => { saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true }); };
  let next = 0, paints = 0, visibility = "visible", text = "Answer", meaningful = true, visible = true, top = 10, clipped = false;
  const frames = new Map<number, FrameRequestCallback>(), listeners = new Set<() => void>();
  let intersection = () => undefined;
  const body = { get innerText() { return text; }, querySelector: () => meaningful ? {} : null,
    checkVisibility: () => visible, getBoundingClientRect: () => ({ width: 100, height: 30, top, bottom: top + 30 }) };
  const article = { querySelector: () => body } as unknown as HTMLElement;
  install("document", { get visibilityState() { return visibility; }, addEventListener: (_event: string, fn: () => void) => listeners.add(fn), removeEventListener: (_event: string, fn: () => void) => listeners.delete(fn) });
  install("window", { innerHeight: 400 });
  install("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++next, fn); return next; });
  install("cancelAnimationFrame", (id: number) => frames.delete(id));
  install("IntersectionObserver", class {
    constructor(private fn: (entries: unknown[]) => void) { intersection = () => { this.fn([{ target: body, isIntersecting: !clipped, intersectionRect: { width: 100, height: clipped ? 0 : 30 } }]); return undefined; }; }
    observe() { intersection(); }
    disconnect() { intersection = () => undefined; }
  });
  const paintFrame = () => { const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn(0); };
  const update = () => { intersection(); paintFrame(); paintFrame(); };
  try {
    const dispose = observePaintedAnswer(article, () => { paints++; });
    paintFrame(); assert.equal(paints, 0); paintFrame(); assert.equal(paints, 1);
    meaningful = false; update(); assert.equal(paints, 1, "a heading is not an answer body"); meaningful = true;
    clipped = true; update(); assert.equal(paints, 1, "ancestor clipping is not visible output"); clipped = false;
    visible = false; update(); assert.equal(paints, 1); visible = true;
    visibility = "hidden"; update(); assert.equal(paints, 1); visibility = "visible";
    top = 500; update(); assert.equal(paints, 1); top = 10;
    text = " "; update(); assert.equal(paints, 1); text = "Answer";
    update(); assert.equal(paints, 2);
    intersection(); paintFrame(); dispose(); paintFrame(); assert.equal(paints, 2);
    assert.equal(listeners.size, 0); assert.equal(frames.size, 0);
    const done = observePaintedAnswer(article, () => true);
    paintFrame(); paintFrame();
    assert.equal(listeners.size, 0, "accepted receipt releases visibility/observer work immediately");
    assert.equal(frames.size, 0); done();
  } finally { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } }
});
