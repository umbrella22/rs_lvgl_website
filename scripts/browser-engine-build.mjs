import fs from "node:fs/promises";
import path from "node:path";
import { emscriptenEnvironment, wasmTarget } from "./emscripten.mjs";
import { repositoryRoot, websiteRoot, runProcess, sha256 } from "./playground-native.mjs";
import { engineInputs, engineRoot, verifyEngineAssets } from "./browser-engine-assets.mjs";

if (process.argv.includes("--check") || process.argv.includes("--ensure")) {
  try { await verifyEngineAssets(); console.log("Verified browser interpreter and native runtime assets."); process.exit(0); }
  catch (error) { if (process.argv.includes("--check")) throw error; console.log(error.message); }
}
const before = await engineInputs();
const { env, toolchain } = await emscriptenEnvironment();
env.CARGO_TARGET_DIR = path.join(repositoryRoot, "target/rspress-browser-engine");
env.CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_RUSTFLAGS = env.CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_RUSTFLAGS.replace(
  "_studio_state", "_studio_state,_exercise_reserve,_exercise_load,_exercise_error_ptr,_exercise_error_len,_exercise_error_field",
);
const result = await runProcess("cargo", ["build", "--offline", "--locked", "--release", "--target", wasmTarget, "--manifest-path", path.join(websiteRoot, "browser-engine/Cargo.toml")], { cwd: repositoryRoot, env, timeout: 600_000 });
await fs.mkdir(env.CARGO_TARGET_DIR, { recursive: true });
await fs.writeFile(path.join(env.CARGO_TARGET_DIR, "build.log"), result.stdout + result.stderr);
if (result.code) throw new Error(result.stderr.slice(-8000));
if ((await engineInputs()).digest !== before.digest) throw new Error("Engine inputs changed during build.");
const built = path.join(env.CARGO_TARGET_DIR, wasmTarget, "release/deps/rs_lvgl_browser_engine");
const outputs = {};
await fs.mkdir(engineRoot, { recursive: true });
for (const [extension, input] of [["mjs", `${built}.js`], ["wasm", `${built}.wasm`]]) {
  const bytes = await fs.readFile(input);
  if (extension === "wasm" && !WebAssembly.validate(bytes)) throw new Error("Invalid engine WebAssembly");
  const name = `engine.${extension}`;
  await fs.writeFile(path.join(engineRoot, name), bytes);
  outputs[name] = sha256(bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}
await fs.writeFile(path.join(engineRoot, "engine.json"), JSON.stringify({ schema: 1, sourceDigest: before.digest, toolchain, outputs }, null, 2) + "\n");
await verifyEngineAssets();
