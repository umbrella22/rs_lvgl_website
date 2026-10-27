import fs from "node:fs/promises";
import path from "node:path";
import { wasmInputs } from "./wasm-assets.mjs";
import { playgroundApps } from "./playground-apps.mjs";
import { websiteRoot, sha256 } from "./playground-native.mjs";
import { sourceInputPath } from "./paths.mjs";

export const playgroundWasmRoot = path.join(websiteRoot, "docs/public/playground-wasm");
export const appManifestPath = path.join(websiteRoot, "playground/generated/apps.json");

export async function appInputs() {
  const native = await wasmInputs();
  const names = ["website/playground/browser.rs", "website/scripts/playground-wasm.mjs", "website/scripts/playground-apps.mjs", "website/scripts/playground-assets.mjs", "website/scripts/build-playground.mjs"];
  const inputs = { native: native.digest, apps: await playgroundApps(), scripts: [] };
  for (const name of names) inputs.scripts.push([name, sha256(await fs.readFile(sourceInputPath(name)))]);
  return { digest: sha256(JSON.stringify(inputs)), inputs };
}

export async function verifyPlaygroundAssets(root = playgroundWasmRoot) {
  const expected = await appInputs();
  const source = JSON.parse(await fs.readFile(appManifestPath, "utf8"));
  if (JSON.stringify(source) !== JSON.stringify(expected.inputs.apps)) throw new Error("Playground source examples are stale.");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
  if (manifest.schema !== 1 || manifest.sourceDigest !== expected.digest) throw new Error("Interactive preset inputs changed; run playground:wasm:build.");
  for (const app of source) {
    for (const extension of ["mjs", "wasm"]) {
      const name = `${app.id}.${extension}`;
      const bytes = await fs.readFile(path.join(root, name));
      if (sha256(bytes) !== manifest.outputs[name]) throw new Error(`Interactive preset differs: ${name}`);
    }
  }
  return manifest;
}
