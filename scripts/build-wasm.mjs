import fs from "node:fs/promises";
import path from "node:path";
import { repositoryRoot, websiteRoot, runProcess, sha256 } from "./playground-native.mjs";
import { emscriptenEnvironment, wasmTarget as target, wasmBuildRoot as buildRoot } from "./emscripten.mjs";
import { wasmRoot, wasmInputs, wasmFiles, verifyWasm, studioSources } from "./wasm-assets.mjs";

const check = process.argv.includes("--check");
const ensure = process.argv.includes("--ensure");
if (check || ensure) {
  try {
    const manifest = await verifyWasm();
    console.log(`Verified Rust/LVGL WebAssembly (${manifest.outputs["studio.wasm"].bytes} bytes).`);
    process.exit(0);
  } catch (error) {
    if (check) throw error;
    console.log("Building browser components:", error.message);
  }
}
const crate = path.join(websiteRoot, "wasm");
await fs.mkdir(buildRoot, { recursive: true });
const { env, toolchain } = await emscriptenEnvironment({ timeout: 600_000 });
const { rust, emscripten } = toolchain;
async function command(cmd, args, options = {}) {
  const result = await runProcess(cmd, args, { cwd: repositoryRoot, timeout: 600_000, ...options });
  if (result.code) throw new Error(`${cmd}: ${result.stderr.slice(-10000)}`);
  return result.stdout.trim();
}
try { await fs.access(path.join(crate, "Cargo.lock")); }
catch { await command("cargo", ["generate-lockfile", "--manifest-path", path.join(crate, "Cargo.toml"), "--offline"], { env }); }
console.log(`Compiling shared component studio with ${rust}; ${emscripten}`);
const result = await runProcess("cargo", ["build", "--manifest-path", path.join(crate, "Cargo.toml"), "--target", target, "--release", "--locked", "--offline"], {
  cwd: repositoryRoot, env, timeout: 600_000, maxOutput: 32 * 1024 * 1024,
});
await fs.writeFile(path.join(buildRoot, "build.log"), result.stdout + result.stderr);
if (result.code) throw new Error(`Wasm build failed (full log: target/rspress-wasm/build.log):\n${result.stderr.slice(-10000)}`);
// Publish only a complete successful build. The manifest is written last.
await fs.mkdir(wasmRoot, { recursive: true });
const built = path.join(buildRoot, target, "release/deps/rs_lvgl_browser_studio");
await fs.copyFile(`${built}.js`, path.join(wasmRoot, "studio.mjs"));
await fs.copyFile(`${built}.wasm`, path.join(wasmRoot, "studio.wasm"));
await fs.writeFile(path.join(crate, "sources.json"), JSON.stringify(await studioSources(), null, 2) + "\n");
const inputs = await wasmInputs();
const outputs = {};
for (const name of wasmFiles) {
  const bytes = await fs.readFile(path.join(wasmRoot, name));
  outputs[name] = { sha256: sha256(bytes), bytes: bytes.length };
}
await fs.writeFile(path.join(wasmRoot, "manifest.json"), JSON.stringify({ schema: 1, sourceDigest: inputs.digest, sources: inputs.sources, toolchain: { rust, emscripten, target }, outputs }, null, 2) + "\n");
await verifyWasm();
console.log(`Built browser studio: ${(outputs["studio.wasm"].bytes / 1024 / 1024).toFixed(2)} MiB Wasm.`);
