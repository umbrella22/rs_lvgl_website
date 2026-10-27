import path from "node:path";
import { repositoryRoot, runProcess } from "./playground-native.mjs";

export const wasmTarget = "wasm32-unknown-emscripten";
export const wasmBuildRoot = path.join(repositoryRoot, "target/rspress-wasm");

export async function emscriptenEnvironment({ signal, timeout = 120_000 } = {}) {
  for (const name of ["LVGL_CONFIG_PATH", "LVGL_EXTRA_C_DIR", "LVGL_EXTRA_HEADERS", "LVGL_CFLAGS", "LVGL_SYSROOT", "CFLAGS", "CXXFLAGS", "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS"]) {
    if (process.env[name]) throw new Error(`Unset ${name} when building documentation previews.`);
  }
  async function command(name, args) {
    const result = await runProcess(name, args, { cwd: repositoryRoot, signal, timeout });
    if (result.code) throw new Error(`${name}: ${result.stderr.slice(-4000)}`);
    return result.stdout.trim();
  }
  const rust = await command("rustc", ["--version"]);
  const emscripten = (await command("emcc", ["--version"])).split("\n")[0];
  // Bindgen needs the target libc headers before the first C compilation.
  await command("embuilder", ["build", "sysroot"]);
  const cache = await command("em-config", ["CACHE"]);
  const options = [
    "MODULARIZE=1", "EXPORT_ES6=1", "ENVIRONMENT=web,worker,node", "ALLOW_MEMORY_GROWTH=1",
    "INCOMING_MODULE_JS_API=wasmBinary,locateFile,printErr,onAbort,noInitialRun",
    "STACK_SIZE=2097152", "EXPORTED_RUNTIME_METHODS=HEAPU8",
    "EXPORTED_FUNCTIONS=_main,_studio_init,_studio_destroy,_studio_frame,_studio_pixels,_studio_pointer,_studio_key,_studio_command,_studio_state",
  ];
  return {
    toolchain: { rust, emscripten, target: wasmTarget },
    env: {
      ...process.env,
      CARGO_TARGET_DIR: wasmBuildRoot,
      CFLAGS_wasm32_unknown_emscripten: "-fwasm-exceptions",
      CXXFLAGS_wasm32_unknown_emscripten: "-fwasm-exceptions",
      CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER: "em++",
      CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_RUSTFLAGS: options.map((value) => `-C link-arg=-s${value}`).join(" "),
      BINDGEN_EXTRA_CLANG_ARGS_wasm32_unknown_emscripten: `--sysroot=${path.join(cache, "sysroot")} -D__EMSCRIPTEN__=1`,
    },
  };
}
