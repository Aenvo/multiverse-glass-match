// Native DOM port of GlassSwitch's gestures, optics and spring motion.
// https://github.com/zakisheriff/Liquid-Glass (MIT, licenses/Liquid-Glass.txt)
import { clamp, createJelly, createSpring, rubberband, SPRINGS, springFrom } from "./vendor/liquid-glass-spring.js";

const REST = 0.655;
const TRAVEL = 22;
const SETTLE = springFrom(0.36, 0.68);

function createLensFilter() {
  const width = 58;
  const height = 38;
  const bezel = height * 0.32;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const context = canvas.getContext("2d");
  const pixels = context.createImageData(canvas.width, canvas.height);
  // Rounded-rectangle distance field and inward rim stretch from the upstream
  // refraction engine. The live track is minified separately inside the lens.
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const px = (x + 0.5) / 2 - width / 2;
      const py = (y + 0.5) / 2 - height / 2;
      const qx = Math.abs(px) - (width - height) / 2;
      const qy = Math.abs(py);
      const length = Math.hypot(Math.max(qx, 0), qy);
      const distance = height / 2 - length;
      const bend = distance >= 0 && distance < bezel ? -bezel * 0.5 * (1 - distance / bezel) ** 2 : 0;
      const nx = Math.max(qx, 0) / Math.max(length, 0.001) * Math.sign(px);
      const ny = qy / Math.max(length, 0.001) * Math.sign(py);
      const index = (y * canvas.width + x) * 4;
      pixels.data[index] = 128 + nx * bend / (0.4 * width) * 255;
      pixels.data[index + 1] = 128 + ny * bend / (0.4 * height) * 255;
      pixels.data[index + 2] = 128;
      pixels.data[index + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.innerHTML = `<defs><filter id="planet-switch-lens" filterUnits="objectBoundingBox"
    primitiveUnits="objectBoundingBox" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">
    <feImage href="${canvas.toDataURL()}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="field"/>
    <feDisplacementMap in="SourceGraphic" in2="field" scale="0.4" xChannelSelector="R" yChannelSelector="G"/>
    </filter></defs>`;
  document.body.append(svg);
}

export function createPlanetSwitch(button, onChange) {
  createLensFilter();
  const thumb = button.querySelector(".planet-switch-thumb");
  const fills = button.querySelectorAll(".planet-switch-fill");
  const copy = button.querySelector(".planet-switch-copy");
  const values = { x: 0, lift: 0, glass: 0, stretch: 0 };
  let checked = false;
  let gesture = null;
  let pointerClick = false;
  let dropTimer;

  function paint() {
    const scale = REST + (1 - REST) * values.lift;
    thumb.style.transform = `translate(${values.x * TRAVEL}px, -50%) scale(${scale * (1 + values.stretch)}, ${scale * (1 - values.stretch * 0.5)})`;
    button.style.setProperty("--planet-lift", String(clamp(values.glass, 0, 1)));
    button.style.setProperty("--planet-knob-x", `${21 + values.x * TRAVEL}px`);
    copy.style.left = `${8 - values.x * TRAVEL}px`;
  }

  const jelly = createJelly(value => { values.stretch = value; paint(); }, 0.14, 5);
  const position = createSpring(0, SPRINGS.snap, (value, velocity) => {
    values.x = value;
    jelly.feed(velocity);
    paint();
  });
  const lift = createSpring(0, SPRINGS.lift, value => {
    values.lift = value;
    values.glass = lift.target ? value : Math.min(values.glass, value);
    paint();
  });
  const color = createSpring(0, SPRINGS.fade, value => {
    for (const fill of fills) fill.style.opacity = String(clamp(value, 0, 1));
  });

  function setChecked(value, instant = false) {
    checked = value;
    button.setAttribute("aria-checked", String(value));
    position.tune(SPRINGS.snap);
    position.set(Number(value), instant);
    color.set(Number(value), instant);
  }

  function drop(delay = 0) {
    clearTimeout(dropTimer);
    dropTimer = setTimeout(() => {
      lift.tune(SETTLE);
      lift.set(0);
    }, delay);
  }

  const flips = (from, raw) => from ? raw > 0.3 : raw > 0.7;

  button.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0 || button.disabled) return;
    clearTimeout(dropTimer);
    const travel = TRAVEL * button.getBoundingClientRect().width / 64;
    gesture = {
      id: event.pointerId, x: event.clientX, from: Number(checked), travel,
      moved: false, at: performance.now(),
    };
    button.setPointerCapture(event.pointerId);
    lift.tune(SPRINGS.lift);
    lift.set(1);
  });
  button.addEventListener("pointermove", event => {
    if (event.pointerId !== gesture?.id) return;
    const dx = event.clientX - gesture.x;
    if (!gesture.moved && Math.abs(dx) < 3) return;
    gesture.moved = true;
    const raw = gesture.from + dx / gesture.travel;
    let value = raw;
    if (raw < 0) value = rubberband(raw * TRAVEL, TRAVEL, 0.6) / TRAVEL;
    if (raw > 1) value = 1 + rubberband((raw - 1) * TRAVEL, TRAVEL, 0.6) / TRAVEL;
    position.tune(SPRINGS.drag);
    position.set(value);
    color.set(Number(flips(gesture.from, raw)));
  });
  button.addEventListener("pointerup", event => {
    if (event.pointerId !== gesture?.id) return;
    const { from, x, moved, at, travel } = gesture;
    gesture = null;
    pointerClick = true;
    const next = moved ? flips(from, from + (event.clientX - x) / travel) : !checked;
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    if (next !== checked) {
      setChecked(next);
      onChange(next);
    } else setChecked(checked);
    drop(moved ? 0 : Math.max(0, 200 - (performance.now() - at)));
  });

  function cancel() {
    const id = gesture?.id;
    gesture = null;
    if (id !== undefined && button.hasPointerCapture(id)) button.releasePointerCapture(id);
    setChecked(checked);
    drop();
  }
  button.addEventListener("pointercancel", cancel);
  button.addEventListener("lostpointercapture", () => { if (gesture) cancel(); });
  window.addEventListener("blur", cancel);
  button.addEventListener("click", event => {
    const fromPointer = pointerClick && event.detail > 0;
    pointerClick = false;
    if (fromPointer || button.disabled) return;
    setChecked(!checked);
    lift.set(1);
    drop(220);
    onChange(checked);
  });
  paint();
  return { setChecked };
}
