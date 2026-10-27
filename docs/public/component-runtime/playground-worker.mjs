let runtime;
let width;
let height;
let generation = -1;
let diagnostic = "";

function interpreterError() {
  const length = runtime?._exercise_error_len?.() ?? 0;
  if (!length) return null;
  const pointer = runtime._exercise_error_ptr();
  const fields = [0, 1, 2, 3].map((field) => runtime._exercise_error_field(field));
  const kind = ["runtime", "syntax", "unsupported", "range", "limit", "type", "name"][runtime._exercise_error_field(4)] ?? "runtime";
  return { kind, message: new TextDecoder().decode(runtime.HEAPU8.slice(pointer, pointer + length)),
    line: fields[0], column: fields[1], endLine: fields[2], endColumn: fields[3] };
}
function checkInterpreter() {
  const error = interpreterError();
  if (error) throw error;
}
function frame(elapsed) {
  if (runtime._studio_frame(elapsed) !== 0) throw new Error(diagnostic || "LVGL frame failed");
  checkInterpreter();
  const next = runtime._studio_state(7);
  const message = { type: "frame", messages: runtime._studio_state(2) };
  if (next !== generation) {
    const pointer = runtime._studio_pixels();
    if (!pointer) throw new Error("LVGL framebuffer is unavailable");
    message.pixels = runtime.HEAPU8.slice(pointer, pointer + width * height * 4).buffer;
    generation = next;
  }
  postMessage(message, message.pixels ? [message.pixels] : []);
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      width = data.width;
      height = data.height;
      const url = URL.createObjectURL(new Blob([data.module], { type: "text/javascript" }));
      try {
        const { default: createApp } = await import(url);
        runtime = await createApp({
          wasmBinary: new Uint8Array(data.wasm),
          locateFile() { return "preview.wasm"; },
          printErr(message) { diagnostic = String(message).slice(-4000); },
        });
      } finally { URL.revokeObjectURL(url); }
      if (typeof data.source === "string") {
        if (!runtime._exercise_load) throw new Error("Browser engine does not support editable source");
        const bytes = new TextEncoder().encode(data.source);
        const pointer = runtime._exercise_reserve(bytes.length);
        if (!pointer) throw { kind: "limit", message: "Source limit: 32 KiB", line: 1, column: 1 };
        runtime.HEAPU8.set(bytes, pointer);
        if (runtime._exercise_load() !== 0) { checkInterpreter(); throw new Error("Source load failed"); }
      }
      if (runtime._studio_init(width, height, Number(data.theme === "dark")) !== 0)
        throw new Error(diagnostic || "LVGL initialization failed");
      frame(20);
    } else if (data.type === "frame") frame(data.elapsed);
    else if (data.type === "pointer") runtime._studio_pointer(data.x, data.y, data.pressed);
    else if (data.type === "key") runtime._studio_key(data.key, data.pressed);
    else if (data.type === "destroy") { runtime?._studio_destroy(); close(); }
  } catch (error) {
    const interpreted = interpreterError() ?? (error.kind ? error : null);
    const detail = interpreted?.message || diagnostic || error.message || String(error);
    const native = detail.match(/^RS_LVGL_PREVIEW_ERROR:([^:]+):([\s\S]*)$/);
    postMessage({ type: "error", kind: native?.[1] === "mount" ? "mount" : "runtime", message: native?.[2] ?? detail, ...(!interpreted && runtime?._exercise_error_field ? { line: runtime._exercise_error_field(5), column: runtime._exercise_error_field(6) } : {}), ...interpreted });
    try { runtime?._studio_destroy(); } finally { close(); }
  }
};
