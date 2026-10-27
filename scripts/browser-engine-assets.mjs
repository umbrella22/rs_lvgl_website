import fs from "node:fs/promises";
import path from "node:path";
import { wasmInputs } from "./wasm-assets.mjs";
import { websiteRoot, sha256 } from "./playground-native.mjs";
import { sourceInputPath } from "./paths.mjs";

export const engineRoot = path.join(websiteRoot, "docs/public/playground-wasm");
export async function engineInputs() {
  const native = await wasmInputs();
  const names = [
    "website/browser-engine/Cargo.toml", "website/browser-engine/Cargo.lock", "website/browser-engine/.gitignore",
    "website/browser-engine/build.rs", "website/playground/browser.rs",
    "website/scripts/browser-engine-assets.mjs", "website/scripts/browser-engine-build.mjs",
  ];
  for (const name of (await fs.readdir(path.join(websiteRoot, "browser-engine/src"))).sort()) names.push(`website/browser-engine/src/${name}`);
  const files = await Promise.all(names.map(async (name) => [name, sha256(await fs.readFile(sourceInputPath(name)))]));
  const inputs = { native: native.digest, files };
  return { inputs, digest: sha256(JSON.stringify(inputs)) };
}
export async function verifyEngineAssets() {
  const expected = await engineInputs();
  const manifest = JSON.parse(await fs.readFile(path.join(engineRoot, "engine.json"), "utf8"));
  if (manifest.schema !== 1 || manifest.sourceDigest !== expected.digest) throw new Error("Browser engine is stale; run browser-engine:build.");
  for (const name of ["engine.mjs", "engine.wasm"]) {
    if (sha256(await fs.readFile(path.join(engineRoot, name))) !== manifest.outputs[name]) throw new Error(`Browser engine differs: ${name}`);
  }
  return manifest;
}
