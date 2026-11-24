// Small choreography helpers. Everything here is decoration: each function
// resolves immediately under reduced motion or when the Web Animations API is
// missing, so the app's state never waits on an animation.
const media = matchMedia("(prefers-reduced-motion: reduce)");
export const calm = () => media.matches;
const can = (node) => node && !calm() && typeof node.animate === "function";

export function play(node, frames, options) {
  if (!can(node)) return Promise.resolve();
  return node
    .animate(frames, { fill: "both", ...options })
    .finished.then(
      (a) => a,
      () => undefined,
    );
}

const visible = (node) => {
  const r = node.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight && r.width > 0;
};

// Count a number up to its final value, then leave the exact final text.
export function countUp(node, value, format, ms = 900) {
  if (!node) return;
  const done = format(value);
  if (!can(node) || !(value > 0)) {
    node.textContent = done;
    return;
  }
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms);
    node.textContent = t < 1 ? format(value * ease(t)) : done;
    if (t < 1) requestAnimationFrame(step);
  };
  node.textContent = format(0);
  requestAnimationFrame(step);
}

// Re-run a short CSS keyframe on an element (used for the slip amount).
export function tick(node, className = "tick") {
  if (!node || calm()) return;
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}

// The slip sinks into its pocket, the flap folds shut and the envelope
// leaves toward the recipient. Skipped when the pocket is off screen.
export async function seal(press) {
  if (!can(press) || !visible(press)) return;
  const slip = press.querySelector(".receipt");
  const flap = press.querySelector(".pocket-flap");
  const timing = (duration, delay = 0, easing = "cubic-bezier(.55,0,.4,1)") => ({
    duration,
    delay,
    easing,
  });
  await Promise.all([
    play(
      slip,
      [
        { transform: "translateY(0)", opacity: 1 },
        { transform: "translateY(38%) scale(.97)", opacity: 1, offset: 0.75 },
        { transform: "translateY(46%) scale(.96)", opacity: 0 },
      ],
      timing(460),
    ),
    play(
      flap,
      [
        { transform: "rotateX(180deg)", opacity: 1 },
        { transform: "rotateX(0deg)", opacity: 1 },
      ],
      timing(380, 260, "cubic-bezier(.3,.8,.3,1.12)"),
    ),
  ]);
  await play(
    press,
    [
      { transform: "none", opacity: 1 },
      { transform: "translate(-6px, 6px) rotate(1deg) scale(.98)", opacity: 1, offset: 0.25 },
      { transform: "translate(90px, -70px) rotate(-9deg) scale(.72)", opacity: 0 },
    ],
    timing(520, 80, "cubic-bezier(.5,0,.75,.2)"),
  );
}

// Ink stamp lands on the slip; the paper takes the impact.
export async function stamp(press) {
  const mark = press?.querySelector(".stamp");
  if (!can(mark)) return;
  const slip = press.querySelector(".receipt");
  await play(
    mark,
    [
      { transform: "rotate(-20deg) scale(2.1)", opacity: 0, filter: "blur(3px)" },
      { transform: "rotate(-9deg) scale(.94)", opacity: 0.95, filter: "blur(0)", offset: 0.72 },
      { transform: "rotate(-9deg) scale(1)", opacity: 0.88, filter: "blur(0)" },
    ],
    { duration: 420, delay: 520, easing: "cubic-bezier(.55,0,.75,.25)" },
  );
  play(
    slip,
    [
      { transform: "translateY(0)" },
      { transform: "translateY(3px) scale(.995)" },
      { transform: "translateY(0)" },
    ],
    { duration: 260, easing: "ease-out", fill: "none" },
  );
}

// Gentle pointer parallax on the closed envelope.
export function tilt(scene) {
  if (!scene || calm() || !matchMedia("(hover: hover) and (pointer: fine)").matches)
    return;
  const target = scene.querySelector(".envelope img");
  if (!target) return;
  let frame = 0;
  scene.addEventListener("pointermove", (e) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const r = scene.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      target.style.setProperty("--tilt-y", (x * 10).toFixed(2) + "deg");
      target.style.setProperty("--tilt-x", (-y * 8).toFixed(2) + "deg");
    });
  });
  scene.addEventListener("pointerleave", () => {
    cancelAnimationFrame(frame);
    target.style.setProperty("--tilt-y", "0deg");
    target.style.setProperty("--tilt-x", "0deg");
  });
}

// Stagger index for lists. Set through the CSSOM so it works under the CSP.
export function stagger(nodes) {
  nodes.forEach((n, i) => n.style.setProperty("--i", String(i)));
}
