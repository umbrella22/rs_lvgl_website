import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { engineRoot, verifyEngineAssets } from "./browser-engine-assets.mjs";
import { verifyPlaygroundAssets } from "./playground-assets.mjs";
import { playgroundApps } from "./playground-apps.mjs";
import { repositoryRoot, websiteRoot, sha256, encodePng } from "./playground-native.mjs";

const index = process.argv.indexOf("--passes");
const passes = index < 0 ? 1 : Number(process.argv[index + 1]);
assert.ok([1, 2, 3].includes(passes));
const manifest = await verifyEngineAssets();
await verifyPlaygroundAssets();
const { default: create } = await import(pathToFileURL(path.join(engineRoot, "engine.mjs")));
const wasmBinary = await fs.readFile(path.join(engineRoot, "engine.wasm"));
const examples = await playgroundApps();
const wrapper = await fs.readFile(path.join(websiteRoot, "playground/view-app.rs"), "utf8");
const source = examples.find((e) => e.id === "switch").source;
const screen = (view) => `use rs_lvgl_ui::prelude::*;\nfn view(theme: &Theme) -> View<()> { ${view} }\n${wrapper}`;
const directory = path.join(repositoryRoot, "target/rspress-browser-engine/acceptance");
await fs.mkdir(directory, { recursive: true });
function diagnostic(app) {
  const length = app._exercise_error_len();
  if (!length) return null;
  const ptr = app._exercise_error_ptr();
  return { message: new TextDecoder().decode(app.HEAPU8.slice(ptr, ptr + length)), line: app._exercise_error_field(0), column: app._exercise_error_field(1), kind: app._exercise_error_field(4) };
}
function load(app, source) {
  const bytes = new TextEncoder().encode(source);
  const pointer = app._exercise_reserve(bytes.length);
  assert.ok(pointer); app.HEAPU8.set(bytes, pointer);
  return app._exercise_load();
}
function advance(app, count = 20) { for (let i = 0; i < count; i++) { assert.equal(app._studio_frame(20), 0); assert.equal(diagnostic(app), null); } }
function pixels(app) { const p = app._studio_pixels(); return Buffer.from(app.HEAPU8.slice(p, p + app._studio_state(0) * app._studio_state(1) * 4)); }
function click(app, x, y) { assert.equal(app._studio_pointer(x, y, 1), 0); advance(app, 3); assert.equal(app._studio_pointer(x, y, 0), 0); advance(app); }
async function instance(text = source, width = 640, height = 400, dark = 0) {
  const app = await create({ wasmBinary, printErr() {} });
  assert.equal(load(app, text), 0, JSON.stringify(diagnostic(app)));
  assert.equal(app._studio_init(width, height, dark), 0, JSON.stringify(diagnostic(app)));
  advance(app); return app;
}
const results = [];
for (let pass = 1; pass <= passes; pass++) {
  const cases = [];
  function passed(name) { cases.push(name); console.log(`PASS ${pass}: ${name}`); }
  for (const example of examples) {
    const app = await instance(example.source);
    const { default: compiled } = await import(pathToFileURL(path.join(engineRoot, `${example.id}.mjs`)));
    const reference = await compiled({ wasmBinary: await fs.readFile(path.join(engineRoot, `${example.id}.wasm`)) });
    assert.equal(reference._studio_init(640, 400, 0), 0);
    for (let i = 0; i < 20; i++) assert.equal(reference._studio_frame(20), 0);
    assert.equal(sha256(pixels(app)), sha256(pixels(reference)), `${example.id} pixel parity`);
    if (example.id === "switch") {
      click(app, 70, 112);
      reference._studio_pointer(70,112,1); for (let i=0;i<3;i++) reference._studio_frame(20);
      reference._studio_pointer(70,112,0); for (let i=0;i<20;i++) reference._studio_frame(20);
      assert.equal(app._studio_state(2), 1);
      assert.equal(sha256(pixels(app)), sha256(pixels(reference)), "state update pixel parity");
    }
    app._studio_destroy(); reference._studio_destroy();
  }
  passed("seven interpreted presets and stateful switch match compiled LVGL pixels");
  const app = await instance();
  const original = sha256(pixels(app));
  click(app, 70, 112); const changed = sha256(pixels(app)); assert.notEqual(changed, original);
  click(app, 60, 220); assert.equal(app._studio_state(2), 2);
  assert.equal(sha256(pixels(app)), original);
  passed("switch and Reset execute update and redraw state");
  assert.equal(app._studio_init(640,400,0), -1);
  assert.equal(app._studio_pointer(-1,0,1), -1);
  assert.equal(app._studio_frame(1001), -1);
  app._studio_destroy(); app._studio_destroy();
  assert.equal(app._studio_pixels(), 0); assert.equal(app._studio_frame(20), -1);
  assert.equal(load(app, source), 0); assert.equal(app._studio_init(640,400,0), 0); advance(app);
  assert.equal(sha256(pixels(app)), original); assert.equal(app._studio_state(2), 0);
  passed("boundary checks, double destroy and reload reset all native state");
  const other = await instance(source,480,320,1); click(app,70,112);
  assert.equal(other._studio_state(0),480); assert.equal(other._studio_state(2),0); assert.equal(app._studio_state(0),640);
  other._studio_destroy(); app._studio_destroy();
  passed("independent native instances, theme and display size");
  const edited = await instance(source.replace('"Notifications"','"Browser edit"').replace('.pad(32)', '.pad(40)'));
  assert.notEqual(sha256(pixels(edited)), original);
  if (pass === 1) await fs.writeFile(path.join(directory,"edited.png"),encodePng(640,400,pixels(edited)));
  edited._studio_destroy();
  passed("edited text and layout render without compilation");
  for (const [text, kind] of [
    [screen('label("oops"'),1], [screen('if false { loop {} } label("ok")'),2],
    [screen('label("x").style(Style::default().width(Size::Px(40000)))'),3],
    [screen('again(theme)') + '\nfn again(theme: &Theme) -> View<()> { again(theme) }',4],
    [screen('label(true)'),5],
    [screen('let value = work(16); label(format!("{value}"))') + '\nfn work(n: u32) -> u32 { if n == 0 { 0 } else { work(n - 1) + work(n - 1) } }',4],
    [screen('label("x").key(Key::Id)') + '\nenum Key { Id }',2],
  ]) {
    const errorApp = await create({wasmBinary,printErr(){}});
    const loaded = load(errorApp,text);
    if (loaded === 0) errorApp._studio_init(640,400,0);
    const error = diagnostic(errorApp);
    assert.ok(error, text); assert.equal(error.kind,kind, JSON.stringify(error)); assert.ok(error.line>0 && error.column>0);
    errorApp._studio_destroy();
    assert.equal(load(errorApp,source),0); assert.equal(errorApp._studio_init(640,400,0),0); advance(errorApp); errorApp._studio_destroy();
  }
  passed("syntax, dead-branch, range, recursion and type diagnostics recover");
  const invalid = await create({wasmBinary,printErr(){}});
  assert.equal(load(invalid,screen('column([label("a").key(Key::Id(1)),label("b").key(Key::Id(1))])')),0);
  assert.equal(invalid._studio_init(640,400,0),-1); assert.equal(invalid._studio_pixels(),0); invalid._studio_destroy();
  passed("duplicate keys fail real native mount and release the partial instance");
  const overflow = await instance(source.replace("changes: 0", "changes: 4294967295"));
  overflow._studio_pointer(70,112,1); for(let i=0;i<3;i++) overflow._studio_frame(20);
  overflow._studio_pointer(70,112,0); for(let i=0;i<20;i++) overflow._studio_frame(20);
  assert.equal(diagnostic(overflow)?.kind,3); overflow._studio_destroy();
  passed("event-time arithmetic failure is reported without unwinding a native callback");
  const slider = source.replace("enabled: bool,", "enabled: bool,\n    level: i32,").replace("Enabled(bool),", "Enabled(bool),\n    Level(i32),")
    .replace("Message::Reset => {", "Message::Level(value) => { self.level = value; }\n            Message::Reset => {")
    .replace("switch(self.enabled).on_value_changed(|value| Message::Enabled(value != 0))", "slider(0, 100, self.level).on_value_changed(|value| Message::Level(value))")
    .replace('label(if self.enabled { "Enabled" } else { "Disabled" })', 'label(format!("{}", self.level))').replace("enabled: false,", "enabled: false,\n        level: 20,");
  const sliderApp = await instance(slider); const sliderBefore = sha256(pixels(sliderApp)); click(sliderApp,150,112);
  assert.ok(sliderApp._studio_state(2)>0); assert.notEqual(sha256(pixels(sliderApp)),sliderBefore); sliderApp._studio_destroy();
  passed("edited slider delivers typed values and redraws its state label");
  assert.equal((await verifyEngineAssets()).sourceDigest,manifest.sourceDigest);
  results.push({pass,time:new Date().toISOString(),sourceDigest:manifest.sourceDigest,cases});
  await fs.writeFile(path.join(directory,"results.json"),JSON.stringify(results,null,2)+"\n");
}
