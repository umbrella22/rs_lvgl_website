import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WasmCompiler } from "./playground-wasm.mjs";
import { playgroundApps } from "./playground-apps.mjs";
import { verifyPlaygroundAssets, appInputs, playgroundWasmRoot } from "./playground-assets.mjs";
import { repositoryRoot, websiteRoot, encodePng, sha256, runProcess } from "./playground-native.mjs";

const args = process.argv.slice(2);
const index = args.indexOf("--passes");
const passes = index < 0 ? 1 : Number(args[index + 1]);
assert.ok([1, 2, 3].includes(passes));
const manifest = await verifyPlaygroundAssets();
const apps = await playgroundApps();
const directory = path.join(repositoryRoot, "target/rspress-interactive/acceptance");
await fs.mkdir(directory, { recursive: true });
const compiler = new WasmCompiler();
const results = [];
async function instance(result) {
  const file = path.join(directory, `${sha256(result.module)}.mjs`);
  await fs.writeFile(file, result.module);
  const { default: createApp } = await import(pathToFileURL(file));
  return createApp({ wasmBinary: Buffer.from(result.wasm, "base64"), printErr() {} });
}
function advance(app, count = 20) {
  for (let n = 0; n < count; n++) assert.equal(app._studio_frame(20), 0);
}
function pixels(app) {
  return Buffer.from(app.HEAPU8.subarray(app._studio_pixels(), app._studio_pixels() + 640 * 400 * 4));
}
function click(app, x, y) {
  assert.equal(app._studio_pointer(x, y, 1), 0); advance(app, 3);
  assert.equal(app._studio_pointer(x, y, 0), 0); advance(app);
}
function labelRegion(bytes) {
  const rows = [];
  for (let y = 155; y < 190; y++) rows.push(bytes.subarray((y * 640 + 32) * 4, (y * 640 + 260) * 4));
  return sha256(Buffer.concat(rows));
}
try {
  for (let pass = 1; pass <= passes; pass++) {
    const cases = [];
    function passed(name) { cases.push(name); console.log(`PASS ${pass}: ${name}`); }
    const hashes = [];
    for (const example of apps) {
      const { default: createApp } = await import(pathToFileURL(path.join(playgroundWasmRoot, `${example.id}.mjs`)));
      const app = await createApp({ wasmBinary: await fs.readFile(path.join(playgroundWasmRoot, `${example.id}.wasm`)) });
      assert.equal(app._studio_init(640, 400, 0), 0); advance(app);
      hashes.push(sha256(pixels(app)));
      app._studio_destroy();
    }
    assert.equal(new Set(hashes).size, apps.length);
    passed("seven source-matched presets render distinct native views");
    const source = apps[0].source;
    const built = await compiler.compile({ source });
    assert.equal(built.ok, true, JSON.stringify(built));
    assert.equal(built.sourceHash, sha256(source));
    const app = await instance(built);
    assert.equal(app._studio_init(640, 400, 0), 0); advance(app);
    const before = pixels(app);
    click(app, 70, 112);
    assert.equal(app._studio_state(2), 1);
    assert.notEqual(labelRegion(pixels(app)), labelRegion(before), "App::update changed the label, not only native switch state");
    if (pass === 1) await fs.writeFile(path.join(directory, "switch-clicked.png"), encodePng(640, 400, pixels(app)));
    passed("copied Rust app receives switch message and redraws state text");
    click(app, 60, 220);
    assert.equal(app._studio_state(2), 2);
    assert.equal(labelRegion(pixels(app)), labelRegion(before));
    passed("reset message restores application state");
    assert.equal(app._studio_init(640, 400, 0), -1);
    assert.equal(app._studio_pointer(-1, 0, 1), -1);
    assert.equal(app._studio_key(0xd800, 1), -1);
    assert.equal(app._studio_frame(1001), -1);
    app._studio_destroy(); app._studio_destroy();
    assert.equal(app._studio_pixels(), 0);
    assert.equal(app._studio_frame(16), -1);
    assert.equal(app._studio_init(640, 400, 0), 0); advance(app);
    assert.equal(app._studio_state(2), 0);
    assert.equal(labelRegion(pixels(app)), labelRegion(before));
    passed("boundary rejection, idempotent cleanup and fresh initialization");
    const other = await instance(built);
    assert.equal(other._studio_init(480, 320, 1), 0); advance(other);
    assert.equal(other._studio_state(0), 480);
    assert.equal(app._studio_state(0), 640);
    click(app, 70, 112);
    assert.equal(other._studio_state(2), 0);
    other._studio_destroy(); app._studio_destroy();
    passed("independent instances and dimensions isolate native state");
    const edited = await compiler.compile({ source: source.replace('"Notifications"', '"Edited settings"') });
    assert.equal(edited.ok, true, JSON.stringify(edited));
    const changed = await instance(edited);
    assert.equal(changed._studio_init(640, 400, 0), 0); advance(changed);
    assert.notEqual(sha256(pixels(changed)), sha256(before)); changed._studio_destroy();
    passed("arbitrary source edit compiles to different real pixels");
    const invalid = source.replace('label("Notifications")', 'missing_widget("Notifications")');
    const compileError = await compiler.compile({ source: invalid });
    const line = invalid.split("\n").findIndex((value) => value.includes("missing_widget")) + 1;
    assert.equal(compileError.kind, "compile");
    assert.ok(compileError.diagnostics.some((item) => item.code === "E0425" && item.line === line && item.column > 0));
    passed("compiler diagnostics refer to the edited source line");
    const wrapper = await fs.readFile(path.join(websiteRoot, "playground/view-app.rs"), "utf8");
    const invalidView = await compiler.compile({ source: 'use rs_lvgl_ui::prelude::*;\nfn view(_: &Theme) -> View<()> { column([label("A").key(Key::Id(1)), label("B").key(Key::Id(1))]) }\n' + wrapper });
    assert.equal(invalidView.ok, true, JSON.stringify(invalidView));
    const invalidApp = await instance(invalidView);
    assert.equal(invalidApp._studio_init(640, 400, 0), -1);
    assert.equal(invalidApp._studio_pixels(), 0); invalidApp._studio_destroy();
    passed("invalid view fails native mount without a live runtime");
    const old = compiler.compile({ source: source.replace('"Notifications"', '"Superseded"') });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const latest = compiler.compile({ source });
    const [cancelled, recovered] = await Promise.all([old, latest]);
    assert.equal(cancelled.kind, "cancelled");
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(recovered.sourceHash, sha256(source));
    passed("superseded compilation stops before the next source is built");
    const second = new WasmCompiler();
    try {
      const [one, two] = await Promise.all([compiler.compile({ source }), second.compile({ source: source.replace('"Notifications"', '"Independent"') })]);
      assert.equal(one.ok, true); assert.equal(two.ok, true);
      assert.notEqual(one.sourceHash, two.sourceHash);
      assert.notEqual(one.wasm, two.wasm);
    } finally { await second.close(); }
    passed("concurrent compilers retain their own source and output");
    const loop = await compiler.compile({ source: 'use rs_lvgl_ui::prelude::*;\nfn view(_: &Theme) -> View<()> { loop {} }\n' + wrapper });
    assert.equal(loop.ok, true, JSON.stringify(loop));
    const loopPath = path.join(directory, "blocking-fixture.json");
    await fs.writeFile(loopPath, JSON.stringify(loop));
    const loopModule = path.join(directory, "blocking.mjs");
    const marker = path.join(directory, `blocking-ready-${pass}`);
    await fs.writeFile(loopModule, loop.module);
    await fs.rm(marker, { force: true });
    const probe = `import fs from 'node:fs/promises'; import {pathToFileURL} from 'node:url'; const result=JSON.parse(await fs.readFile(process.argv[1])); const {default:create}=await import(pathToFileURL(process.argv[2])); const app=await create({wasmBinary:Buffer.from(result.wasm,'base64')}); await fs.writeFile(process.argv[3],'wasm initialized'); app._studio_init(640,400,0);`;
    await assert.rejects(runProcess(process.execPath, ["--input-type=module", "-e", probe, loopPath, loopModule, marker], { timeout: 1000 }), (error) => error.kind === "timeout");
    assert.equal(await fs.readFile(marker, "utf8"), "wasm initialized");
    passed("blocking user view is contained in a terminable execution context");
    assert.equal((await appInputs()).digest, manifest.sourceDigest);
    results.push({ pass, time: new Date().toISOString(), cases, sourceDigest: manifest.sourceDigest });
    await fs.writeFile(path.join(directory, "results.json"), JSON.stringify(results, null, 2) + "\n");
  }
} finally { await compiler.close(); }
