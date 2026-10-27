import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { appInputs, appManifestPath, verifyPlaygroundAssets } from "./playground-assets.mjs";
import { sha256 } from "./playground-native.mjs";

test("interactive preset verification rejects stale sources, modified modules and missing binaries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lvgl-presets-"));
  try {
    const expected = await appInputs();
    assert.deepEqual(JSON.parse(await fs.readFile(appManifestPath, "utf8")), expected.inputs.apps);
    const bytes = Buffer.from("artifact identity fixture");
    const manifest = { schema: 1, sourceDigest: expected.digest, outputs: {} };
    for (const app of expected.inputs.apps) {
      for (const ext of ["mjs", "wasm"]) {
        const file = `${app.id}.${ext}`;
        await fs.writeFile(path.join(root, file), bytes);
        manifest.outputs[file] = sha256(bytes);
      }
    }
    async function write() { await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest)); }
    await write(); await verifyPlaygroundAssets(root);
    manifest.sourceDigest = "stale"; await write();
    await assert.rejects(verifyPlaygroundAssets(root), /inputs changed/);
    manifest.sourceDigest = expected.digest; await write();
    await fs.writeFile(path.join(root, "switch.mjs"), "modified");
    await assert.rejects(verifyPlaygroundAssets(root), /preset differs/);
    await fs.writeFile(path.join(root, "switch.mjs"), bytes);
    await fs.rm(path.join(root, "switch.wasm"));
    await assert.rejects(verifyPlaygroundAssets(root), /ENOENT/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
