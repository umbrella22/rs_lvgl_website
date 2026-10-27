import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyWasm } from "./wasm-assets.mjs";
import { sha256 } from "./playground-native.mjs";

// Standalone artifact controls do not require installing Emscripten for unit tests.
test("Wasm validation rejects stale identities, changed bytes, missing output and invalid binaries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lvgl-wasm-"));
  const bytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  const js = "export default function() {}";
  const outputs = {
    "studio.wasm": { sha256: sha256(bytes), bytes: bytes.length },
    "studio.mjs": { sha256: sha256(js), bytes: Buffer.byteLength(js) },
  };
  const manifest = { schema: 1, sourceDigest: "current", outputs };
  const write = () => fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
  try {
    await fs.writeFile(path.join(root, "studio.wasm"), bytes);
    await fs.writeFile(path.join(root, "studio.mjs"), js);
    await write();
    await verifyWasm(root, { digest: "current" });
    await assert.rejects(verifyWasm(root, { digest: "stale" }), /source changed/);
    await fs.writeFile(path.join(root, "studio.wasm"), "bad");
    await assert.rejects(verifyWasm(root, { digest: "current" }), /artifact differs/);
    manifest.outputs["studio.wasm"] = { sha256: sha256("bad"), bytes: 3 }; await write();
    await assert.rejects(verifyWasm(root, { digest: "current" }), /Invalid WebAssembly/);
    await fs.unlink(path.join(root, "studio.mjs"));
    await assert.rejects(verifyWasm(root, { digest: "current" }), /ENOENT/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
