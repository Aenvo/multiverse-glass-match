import { makeShape, seedRandom } from "./board.js";
import { Game, PLANET_FUSION_TIME } from "./game.js";
import { layoutFor } from "./motion.js";
import { GlassRenderer } from "./renderer.js";
import { orbVariants } from "./vendor/orbkit.js";
import { orbTypes } from "./orb-types.js";
import { APPEARANCE_KEY, catalogs, randomTypes, readAppearance, serializeAppearance } from "./appearance.js";
import { createPlanetSwitch } from "./planet-switch.js";

const canvas = document.querySelector("#board");
const themeSwitch = document.querySelector("#theme-switch");
const themeColor = document.querySelector('meta[name="theme-color"]');
const planetSwitch = document.querySelector("#planet-switch");
const modeStatus = document.querySelector("#mode-status");
const shuffleButton = document.querySelector("#shuffle-orbs");
let saved;
try { saved = sessionStorage.getItem(APPEARANCE_KEY); } catch {}
const appearance = readAppearance(saved);
const initialMode = appearance.mode;
let mode = "orbs";
let requestedMode = initialMode;
let selectedTypes = appearance.selections.orbs.some(type => type.kind === "planet")
  ? orbTypes : appearance.selections.orbs;
const seed = new URLSearchParams(location.search).get("seed");
const random = seed === null ? Math.random : seedRandom(Number(seed));
let shape = makeShape(random);
const layout = () => layoutFor(canvas.clientWidth, canvas.clientHeight, shape.width, shape.height);
let game = new Game(shape, random, layout());
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const orbFusionDuration = game.fusionDuration;
let renderer = new GlassRenderer(canvas, selectedTypes);
let renderReady = true;
let pointerId = null;
let lastFrame = 0;
let cursor = "";
let night = Number(document.documentElement.dataset.theme === "night");
let nightFrom = night;
let nightTarget = night;
let themeStarted = 0;
themeSwitch.setAttribute("aria-checked", String(night === 1));

const shaderBook = document.querySelector("#shader-book");
const shaderDialog = document.querySelector("#shader-dialog");
const shaderList = document.querySelector("#shader-list");
const shaderBody = document.querySelector(".shader-body");
const shaderEdit = document.querySelector("#shader-edit");
const shaderEditor = document.querySelector("#shader-editor");
const shaderApply = document.querySelector("#shader-apply");
let shaderPreviews = [];
let previewEpoch = 0;
let previewBusy = false;
let editing = false;
let draftShaders = new Set(selectedTypes.map(type => type.field));
let busy = false;
let operation = 0;
let pendingAppearance = null;
const switchControl = createPlanetSwitch(planetSwitch, checked => {
  requestAppearance(checked ? "planets" : "orbs");
});

function saveAppearance() {
  try { sessionStorage.setItem(APPEARANCE_KEY, serializeAppearance(appearance)); } catch {}
}

function showStatus(message, error = false) {
  modeStatus.textContent = message;
  modeStatus.hidden = !message;
  modeStatus.dataset.error = String(error);
}

function updateSelection() {
  const active = new Set(selectedTypes.map(type => type.field));
  for (const { type, entry, checkbox, number } of shaderPreviews) {
    const isActive = active.has(type.field);
    entry.dataset.active = String(isActive);
    checkbox.checked = draftShaders.has(type.field);
    checkbox.disabled = busy || !renderer || (draftShaders.size === 4 && !checkbox.checked);
    entry.dataset.selected = String(editing && checkbox.checked);
    number.textContent = isActive ? `${type.shader} · Active` : type.shader;
  }
  document.querySelector("#shader-selection-count").textContent = `${draftShaders.size} of 4 worlds selected`;
  document.querySelector("#shader-selection-count").dataset.error = "false";
  shaderApply.disabled = draftShaders.size !== 4 || busy || !renderer;
}

function setBusy(value) {
  busy = value;
  planetSwitch.setAttribute("aria-busy", String(value));
  shuffleButton.disabled = value || !renderer;
  shaderEdit.disabled = value || !renderer;
  updateSelection();
}

function setEditing(value) {
  editing = value;
  draftShaders = new Set(selectedTypes.map(type => type.field));
  shaderDialog.dataset.editing = String(editing);
  shaderEdit.setAttribute("aria-pressed", String(editing));
  shaderEditor.hidden = !editing;
  updateSelection();
}

async function showSource(type, code) {
  try {
    const owner = renderer;
    if (!owner) throw new Error("Graphics are being restored");
    await owner.prepareOrbTypes([type]);
    if (renderer !== owner || !code.isConnected) return;
    if (type.kind === "planet") {
      code.textContent = "// Planet material by Aenvo for Multiverse Glass Match.\n"
        + "// See LICENSE.md and CREDITS.md for code and texture terms.\n" + owner.planetSources.get(type.source);
    } else {
      const variant = orbVariants[type.field];
      const notice = variant.notice ?? ("// Shader by XorDev (https://x.com/XorDev). Non-commercial use only.\n"
        + "// Adapted for Orbkit. See licenses/Orbkit-shaders.md.\n");
      code.textContent = notice + variant.fragment;
    }
  } catch {
    code.textContent = "Could not load this source. Close and reopen to try again.";
    code.dataset.failed = "true";
  }
}

function buildCatalog() {
  previewEpoch++;
  previewBusy = false;
  shaderList.replaceChildren();
  const modeName = mode === "planets" ? "Planet Mode" : "Otherworld Mode";
  document.querySelector("#shader-title").textContent = `${modeName} gallery`;
  document.querySelector("#planet-switch").title = `${modeName} · Switch to ${mode === "planets" ? "Otherworld Mode" : "Planet Mode"}`;
  const credit = document.querySelector("#shader-credit");
  credit.innerHTML = mode === "planets"
    ? 'Non-commercial project · Planet materials by Aenvo<br>Textures · <a href="https://visibleearth.nasa.gov/collection/1484/blue-marble" target="_blank" rel="noopener noreferrer">NASA Visible Earth</a> / <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener noreferrer">Solar System Scope / INOVE · CC BY 4.0</a> · <a href="https://github.com/Aenvo/multiverse-glass-match/blob/main/CREDITS.md" target="_blank" rel="noopener noreferrer">Full credits</a>'
    : 'Non-commercial use only · Orbkit shaders by <a href="https://x.com/XorDev" target="_blank" rel="noopener noreferrer">XorDev</a> / <a href="https://github.com/zzzzshawn/orbkit" target="_blank" rel="noopener noreferrer">zzzzshawn</a> · Azure world by Aenvo · <a href="https://github.com/Aenvo/multiverse-glass-match/blob/main/CREDITS.md" target="_blank" rel="noopener noreferrer">Full credits</a>';
  shaderPreviews = catalogs[mode].map(type => {
    const { field, name, shader } = type;
    const entry = document.createElement("article");
    entry.className = "shader-entry";
    entry.dataset.field = field;
    const choice = document.createElement("label");
    choice.className = "shader-choice";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute("aria-label", `Select ${shader} ${name}`);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) draftShaders.add(field);
      else draftShaders.delete(field);
      updateSelection();
    });
    entry.addEventListener("click", event => {
      if (busy || !editing || event.target.closest(".shader-choice, details")) return;
      checkbox.click();
    });
    choice.append(checkbox);
    const preview = document.createElement("canvas");
    preview.className = "shader-preview";
    preview.setAttribute("role", "img");
    preview.setAttribute("aria-label", `${name} shader preview`);
    const info = document.createElement("div");
    info.className = "shader-info";
    const number = document.createElement("p");
    number.className = "shader-number";
    const heading = document.createElement("h2");
    heading.textContent = name;
    info.append(number, heading);
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "View GLSL source";
    const pre = document.createElement("pre");
    pre.tabIndex = 0;
    pre.setAttribute("aria-label", `${name} GLSL source`);
    const code = document.createElement("code");
    details.addEventListener("toggle", () => {
      if (details.open && (!code.textContent || code.dataset.failed)) {
        delete code.dataset.failed;
        showSource(type, code);
      }
    });
    pre.append(code);
    details.append(summary, pre);
    entry.append(choice, preview, info, details);
    shaderList.append(entry);
    return { canvas: preview, type, entry, number, checkbox, ready: false, failed: false };
  });
  setEditing(false);
}

async function prepareNextPreview() {
  if (previewBusy || !shaderDialog.open || !renderer || busy) return;
  if (mode === "planets" && Math.abs(night - nightTarget) > 0.001) return;
  const bounds = shaderBody.getBoundingClientRect();
  const preview = shaderPreviews.find(item => {
    if (item.ready || item.failed) return false;
    const rect = item.entry.getBoundingClientRect();
    return rect.top < bounds.bottom && rect.bottom > bounds.top;
  });
  if (!preview) return;
  previewBusy = true;
  const epoch = previewEpoch;
  const owner = renderer;
  try {
    await owner.prepareOrbTypes([preview.type]);
    if (epoch !== previewEpoch || renderer !== owner || !shaderDialog.open) return;
    owner.copyOrbPreview(preview.canvas, preview.type);
    preview.ready = true;
    preview.canvas.dataset.ready = "true";
  } catch {
    if (epoch === previewEpoch && renderer === owner) {
      preview.failed = true;
      const note = document.createElement("p");
      note.className = "shader-preview-error";
      note.textContent = "Could not load this preview. Reopen the gallery to try again.";
      preview.entry.querySelector(".shader-info").append(note);
    }
  } finally {
    if (epoch === previewEpoch) previewBusy = false;
  }
}

async function requestAppearance(nextMode, types = appearance.selections[nextMode], reset = false) {
  if (!renderer) return;
  const id = ++operation;
  const owner = renderer;
  requestedMode = nextMode;
  pendingAppearance = null;
  release(false);
  game.cursor = null;
  switchControl.setChecked(nextMode === "planets");
  setBusy(true);
  showStatus("Preparing worlds…");
  try {
    await owner.prepareOrbTypes(types);
    if (operation !== id || renderer !== owner) return;
    pendingAppearance = { mode: nextMode, types, reset };
    if (game.phase) showStatus("Switching when the board settles…");
  } catch (error) {
    if (operation !== id || renderer !== owner) return;
    requestedMode = mode;
    switchControl.setChecked(mode === "planets");
    planetSwitch.disabled = false;
    setBusy(false);
    appearance.mode = mode;
    saveAppearance();
    if (shaderDialog.open && editing) {
      const status = document.querySelector("#shader-selection-count");
      status.textContent = "Could not load this selection. Please try again.";
      status.dataset.error = "true";
    }
    showStatus("Could not load worlds. Please try again.", true);
    console.error(error);
  }
}

function commitAppearance() {
  if (!pendingAppearance || game.phase || game.drag || !renderer) return;
  const next = pendingAppearance;
  pendingAppearance = null;
  renderer.setOrbTypes(next.types);
  const changedMode = mode !== next.mode;
  mode = next.mode;
  requestedMode = mode;
  selectedTypes = next.types;
  appearance.mode = mode;
  appearance.selections[mode] = selectedTypes;
  if (next.reset) {
    shape = makeShape(random);
    game = new Game(shape, random, layout());
  }
  game.fusionDuration = mode === "planets" ? PLANET_FUSION_TIME : orbFusionDuration;
  renderReady = true;
  canvas.dataset.mode = mode;
  switchControl.setChecked(mode === "planets");
  planetSwitch.disabled = false;
  setBusy(false);
  if (changedMode) buildCatalog();
  else setEditing(false);
  shaderDialog.close();
  saveAppearance();
  showStatus("");
}

shaderEdit.addEventListener("click", () => setEditing(!editing));
document.querySelector("#shader-cancel").addEventListener("click", () => {
  setEditing(false);
  shaderEdit.focus();
});
shaderApply.addEventListener("click", () => {
  if (draftShaders.size !== 4 || busy || !renderer) return;
  requestAppearance(mode, catalogs[mode].filter(({ field }) => draftShaders.has(field)));
});
shaderDialog.addEventListener("close", () => setEditing(false));
shuffleButton.addEventListener("click", () => requestAppearance(mode, randomTypes(mode), true));
shaderBook.addEventListener("click", () => {
  release(false);
  game.cursor = null;
  for (const preview of shaderPreviews) {
    preview.failed = false;
    if (preview.type.kind === "planet") {
      preview.ready = false;
      delete preview.canvas.dataset.ready;
    }
  }
  shaderList.querySelectorAll(".shader-preview-error").forEach(note => note.remove());
  shaderDialog.showModal();
});
document.querySelector("#shader-close").addEventListener("click", () => shaderDialog.close());
shaderDialog.addEventListener("click", event => {
  if (event.target !== shaderDialog) return;
  const bounds = shaderDialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right
    || event.clientY < bounds.top || event.clientY > bounds.bottom) shaderDialog.close();
});

buildCatalog();
canvas.dataset.mode = mode;
if (initialMode === "planets" || selectedTypes !== appearance.selections.orbs) requestAppearance(initialMode);
else saveAppearance();

themeSwitch.addEventListener("click", () => {
  nightFrom = night;
  nightTarget = 1 - nightTarget;
  themeStarted = performance.now();
  themeSwitch.setAttribute("aria-checked", String(nightTarget === 1));
  document.documentElement.dataset.theme = nightTarget ? "night" : "day";
  themeColor.content = nightTarget ? "#000000" : "#ffffff";
  try {
    sessionStorage.setItem("liquid-glass-theme", nightTarget ? "night" : "day");
  } catch {}
});

function inside(event) {
  return event.clientX >= 0 && event.clientX < canvas.clientWidth
    && event.clientY >= 0 && event.clientY < canvas.clientHeight;
}

function release(commit) {
  if (pointerId === null) return;
  const id = pointerId;
  pointerId = null;
  game.release(commit);
  if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
}

canvas.addEventListener("pointerdown", event => {
  if (!renderer || !renderReady) return;
  if (event.pointerType !== "mouse" || event.button !== 0 || pointerId !== null) return;
  if (game.press(event.clientX, event.clientY)) {
    pointerId = event.pointerId;
    canvas.setPointerCapture(pointerId);
  }
});

canvas.addEventListener("pointermove", event => {
  if (event.pointerType !== "mouse" || (pointerId !== null && pointerId !== event.pointerId)) return;
  if (inside(event)) {
    game.move(event.clientX, event.clientY);
  } else {
    game.cursor = null;
    release(false);
  }
});

canvas.addEventListener("pointerup", event => {
  if (pointerId !== event.pointerId) return;
  const inView = inside(event);
  if (inView) game.move(event.clientX, event.clientY);
  release(inView);
});

canvas.addEventListener("pointerleave", () => { game.cursor = null; });
canvas.addEventListener("pointercancel", event => { if (pointerId === event.pointerId) release(false); });
canvas.addEventListener("lostpointercapture", event => { if (pointerId === event.pointerId) release(false); });
window.addEventListener("blur", () => release(false));
window.addEventListener("resize", () => {
  release(false);
  game.layout = layout();
});

canvas.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  if (renderer) renderer.valid = false;
  renderer = null;
  renderReady = false;
  operation++;
  pendingAppearance = null;
  previewEpoch++;
  previewBusy = false;
  planetSwitch.disabled = true;
  setBusy(true);
  showStatus("Restoring graphics…");
  release(false);
});
canvas.addEventListener("webglcontextrestored", () => {
  renderer = new GlassRenderer(canvas);
  requestAppearance(requestedMode);
});

function frame(now) {
  const dt = lastFrame ? Math.min(0.04, (now - lastFrame) / 1000) : 0;
  lastFrame = now;
  game.step(dt);
  commitAppearance();
  const themeProgress = Math.min(1, Math.max(0, (now - themeStarted) / 360));
  const themeEase = themeProgress * themeProgress * (3 - 2 * themeProgress);
  night = nightFrom + (nightTarget - nightFrom) * themeEase;
  if (renderer && renderReady) {
    const { tiles, fusions } = game.view();
    renderer.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
    renderer.render(tiles, fusions, now / 1000, night, reducedMotion.matches);
    prepareNextPreview();
  }
  if (game.pointer !== cursor) {
    cursor = game.pointer;
    canvas.dataset.pointer = cursor;
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
