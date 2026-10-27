const en = new URLSearchParams(location.search).get("lang") === "en";
const words = en ? {
  restart: "Restart",
  loading: "Loading Rust + LVGL…", ready: "Running in your browser", stopped: "Studio closed · restart to explore again",
  error: "Could not start the studio. Check your connection, then restart.",
  hint: "Click or drag · focus the canvas for keyboard input · Esc leaves keyboard focus",
  pages: ["Overview", "Controls", "Text & input", "Data & charts", "Layout", "Media & codes", "Canvas & motion", "Composition", "Native extras"],
} : {
  restart: "重新开始",
  loading: "正在加载 Rust + LVGL…", ready: "正在浏览器中运行", stopped: "工作台已关闭 · 点击重新开始继续体验",
  error: "组件工作台加载失败，请检查网络后重新开始。",
  hint: "点击或拖动 · 聚焦画布后可用键盘输入 · Esc 退出键盘焦点",
  pages: ["总览", "基础控件", "文本与输入", "数据与图表", "布局", "媒体与编码", "画布与动画", "组合组件", "原生扩展"],
};
document.documentElement.lang = en ? "en" : "zh-CN";
for (const element of document.querySelectorAll("[data-text]")) element.textContent = words[element.dataset.text];
const byId = (id) => document.getElementById(id);
const canvas = byId("screen");
const context = canvas.getContext("2d", { alpha: false });
const status = byId("status");
const loading = byId("loading");
const loadingText = byId("loading-text");
byId("restart").textContent = words.restart;
byId("hint").textContent = words.hint;
canvas.setAttribute("aria-label", en ? "Live LVGL components. Press Escape to leave canvas keyboard focus." : "可交互的 LVGL 组件，按 Esc 退出画布键盘焦点。");
let runtime;
let download;
let ticket = 0;
let animation = 0;
let lastTime = 0;
let painted = -1;
let pointerId;
let lastPointer = { x: 0, y: 0 };
let reportedPage = -1;
const heldKeys = new Set();
const listeners = new AbortController();
function listen(target, name, fn, options = {}) { target.addEventListener(name, fn, { ...options, signal: listeners.signal }); }
function releaseInput() {
  if (!runtime) return;
  runtime._studio_pointer(lastPointer.x, lastPointer.y, 0);
  for (const key of heldKeys) runtime._studio_key(key, 0);
  heldKeys.clear();
  if (pointerId !== undefined && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  pointerId = undefined;
}
function stop() {
  cancelAnimationFrame(animation);
  download?.abort();
  download = undefined;
  const previous = runtime;
  runtime = undefined;
  heldKeys.clear();
  if (pointerId !== undefined && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  pointerId = undefined;
  try { previous?._studio_destroy(); }
  catch (error) { console.error("Studio teardown failed", error); }
}
function fail(error) {
  stop();
  byId("display").setAttribute("aria-busy", "false");
  loading.hidden = false;
  byId("restart").hidden = false;
  loadingText.textContent = `${words.error}\n${error.message || error}`;
  status.textContent = en ? "Load or runtime error" : "加载或运行错误";
}
function draw() {
  const generation = runtime._studio_state(7);
  if (generation === painted) return;
  const pointer = runtime._studio_pixels();
  if (!pointer) throw new Error("LVGL framebuffer is unavailable");
  // Copy immediately. Emscripten may grow memory during the next native call.
  const pixels = new Uint8ClampedArray(runtime.HEAPU8.buffer, pointer, 1280 * 860 * 4);
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels), 1280, 860), 0, 0);
  painted = generation;
}
function frame(now) {
  if (!runtime || document.hidden) return;
  try {
    const elapsed = lastTime ? Math.min(100, Math.max(0, Math.round(now - lastTime))) : 16;
    lastTime = now;
    if (runtime._studio_frame(elapsed) !== 0) throw new Error("LVGL could not advance the frame");
    draw();
    const page = runtime._studio_state(0);
    if (reportedPage !== page) {
      reportedPage = page;
      parent.postMessage({ type: "rs-lvgl-studio-page", page: reportedPage }, location.origin);
      reportHeight();
    }
    const label = `${words.ready} · ${words.pages[page]} · ${runtime._studio_state(1)}%`;
    if (status.textContent !== label) status.textContent = label;
    if (runtime._studio_state(8) === 1) {
      stop();
      status.textContent = words.stopped;
      loading.hidden = false;
      loadingText.textContent = words.stopped;
      byId("restart").hidden = false;
      return;
    }
    animation = requestAnimationFrame(frame);
  } catch (error) { fail(error); }
}
async function start() {
  const current = ++ticket;
  stop();
  const controller = new AbortController();
  download = controller;
  painted = -1;
  reportedPage = -1;
  lastTime = 0;
  byId("display").setAttribute("aria-busy", "true");
  loading.hidden = false;
  loadingText.textContent = words.loading;
  byId("restart").hidden = true;
  status.textContent = words.loading;
  try {
    if (!context || typeof WebAssembly !== "object") throw new Error("WebAssembly and Canvas 2D are required");
    const { default: createStudio } = await import("../wasm/studio.mjs");
    const response = await fetch(new URL("../wasm/studio.wasm", import.meta.url), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
    if (!response.ok) throw new Error(`WebAssembly download: HTTP ${response.status}`);
    const instance = await createStudio({ wasmBinary: new Uint8Array(await response.arrayBuffer()), printErr: (message) => console.error(message) });
    if (current !== ticket) return;
    runtime = instance;
    if (runtime._studio_init() !== 0) throw new Error("LVGL initialization failed");
    loading.hidden = true;
    byId("display").setAttribute("aria-busy", "false");
    animation = requestAnimationFrame(frame);
  } catch (error) { if (current === ticket) fail(error); }
}
listen(byId("restart"), "click", start);
function sendPointer(event, pressed) {
  if (!runtime) return;
  const box = canvas.getBoundingClientRect();
  const x = Math.min(1279, Math.max(0, Math.floor((event.clientX - box.left) * 1280 / box.width)));
  const y = Math.min(859, Math.max(0, Math.floor((event.clientY - box.top) * 860 / box.height)));
  lastPointer = { x, y };
  runtime._studio_pointer(x, y, pressed ? 1 : 0);
}
listen(canvas, "pointerdown", (event) => {
  if (!event.isPrimary || event.button !== 0 || !runtime) return;
  canvas.focus({ preventScroll: true });
  pointerId = event.pointerId;
  canvas.setPointerCapture(pointerId);
  sendPointer(event, true);
});
listen(canvas, "pointermove", (event) => { if (event.pointerId === pointerId) sendPointer(event, true); });
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) listen(canvas, name, (event) => {
  if (event.pointerId !== pointerId) return;
  sendPointer(event, false);
  pointerId = undefined;
});
const specialKeys = { ArrowUp: 17, ArrowDown: 18, ArrowRight: 19, ArrowLeft: 20, Escape: 27, Delete: 127, Backspace: 8, Enter: 10, Home: 2, End: 3 };
function nativeKey(event) {
  if (event.key === "Tab") return event.shiftKey ? 11 : 9;
  return specialKeys[event.key] ?? ([...event.key].length === 1 ? event.key.codePointAt(0) : undefined);
}
listen(canvas, "keydown", (event) => {
  if (event.key === "Escape") { releaseInput(); byId("hint").focus(); parent.postMessage({ type: "rs-lvgl-studio-escape" }, location.origin); return; }
  if (!runtime || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
  const key = nativeKey(event);
  if (key === undefined) return;
  event.preventDefault();
  runtime._studio_key(key, 1);
  heldKeys.add(key);
});
listen(canvas, "keyup", (event) => {
  const key = nativeKey(event);
  if (!runtime || key === undefined || !heldKeys.has(key)) return;
  event.preventDefault();
  runtime._studio_key(key, 0);
  heldKeys.delete(key);
});
listen(canvas, "blur", releaseInput);
listen(document, "visibilitychange", () => {
  releaseInput();
  cancelAnimationFrame(animation);
  lastTime = 0;
  if (!document.hidden && runtime) animation = requestAnimationFrame(frame);
});
function reportHeight() {
  parent.postMessage({ type: "rs-lvgl-studio-height", height: document.body.scrollHeight + 2 }, location.origin);
}
listen(window, "message", (event) => {
  if (event.source === parent && event.origin === location.origin && event.data?.type === "rs-lvgl-studio-measure") reportHeight();
});
const observer = new ResizeObserver(reportHeight);
observer.observe(document.body);
listen(window, "pagehide", (event) => {
  ++ticket;
  stop();
  if (!event.persisted) { observer.disconnect(); listeners.abort(); }
});
listen(window, "pageshow", (event) => { if (event.persisted) start(); });
start();
