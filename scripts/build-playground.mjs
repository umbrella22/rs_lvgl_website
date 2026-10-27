import fs from "node:fs/promises";
import path from "node:path";
import { WasmCompiler } from "./playground-wasm.mjs";
import { appInputs, appManifestPath, playgroundWasmRoot, verifyPlaygroundAssets } from "./playground-assets.mjs";
import { sha256 } from "./playground-native.mjs";

if (process.argv.includes("--check") || process.argv.includes("--ensure")) {
  try {
    await verifyPlaygroundAssets();
    console.log("Verified source and WebAssembly for all seven interactive presets.");
    process.exit(0);
  } catch (error) {
    if (process.argv.includes("--check")) throw error;
    console.log("Building interactive presets:", error.message);
  }
}
const compiler = new WasmCompiler({ compileTimeout: 600_000 });
try {
  const inputs = await appInputs();
  await fs.mkdir(playgroundWasmRoot, { recursive: true });
  const outputs = {};
  for (const app of inputs.inputs.apps) {
    const result = await compiler.compile({ source: app.source });
    if (!result.ok) throw new Error(`${app.id}: ${JSON.stringify(result)}`);
    for (const [extension, bytes] of [["mjs", Buffer.from(result.module)], ["wasm", Buffer.from(result.wasm, "base64")]]) {
      const name = `${app.id}.${extension}`;
      await fs.writeFile(path.join(playgroundWasmRoot, name), bytes);
      outputs[name] = sha256(bytes);
    }
    console.log(`Built interactive ${app.id}: ${result.elapsedMs} ms`);
  }
  await fs.writeFile(appManifestPath, JSON.stringify(inputs.inputs.apps, null, 2) + "\n");
  await fs.writeFile(path.join(playgroundWasmRoot, "manifest.json"), JSON.stringify({ schema: 1, sourceDigest: inputs.digest, toolchain: compiler.environment.toolchain, outputs }, null, 2) + "\n");
  await verifyPlaygroundAssets();
} finally { await compiler.close(); }
