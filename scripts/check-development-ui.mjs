// Compile composition and forms with the native Playground engine and an explicit source.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { NativeRenderer, decodeNativePng, runProcess, sha256, websiteRoot } from "./playground-native.mjs";

const args = process.argv.slice(2);
const index = args.indexOf("--source");
const selected = index < 0 ? process.env.RS_LVGL_SOURCE : args[index + 1];
if (!selected) throw new Error("Choose the library source with --source PATH or RS_LVGL_SOURCE.");
const librarySource = await fs.realpath(path.resolve(selected));
const artifactRoot = path.join(websiteRoot, "target/development-ui");
await fs.mkdir(artifactRoot, { recursive: true });

async function identity() {
  const listed = await runProcess("git", ["ls-files", "-cz", "--others", "--exclude-standard"], { cwd: librarySource });
  assert.equal(listed.code, 0, listed.stderr);
  const names = listed.stdout.split("\0").filter((name) =>
    name === "Cargo.toml" || (/^rs_lvgl(?:_sys|_ui|_codegen)?\//.test(name) &&
      !/\/(tests|examples)\//.test(name) && /\.(rs|toml|c|h|cpp|hpp)$/.test(name)));
  const files = [];
  for (const name of [...new Set(names)].sort())
    files.push([name, sha256(await fs.readFile(path.join(librarySource, name)))]);
  return sha256(JSON.stringify(files));
}
const before = await identity();
const source = await fs.readFile(path.join(websiteRoot, "playground/development/forms.rs"), "utf8");
const controlsSource = await fs.readFile(path.join(websiteRoot, "playground/examples/controls.rs"), "utf8");
const skillSource = await fs.readFile(path.join(librarySource, ".agents/skills/rs-lvgl-ui/references/form.rs"), "utf8");
const skillMain = skillSource.indexOf("fn main()");
assert.ok(skillMain > 0, "the runnable skill must contain its standalone main");
// The Playground includes the snippet after its own items, so retain crate
// documentation as ordinary comments in this test adapter.
const skillView = skillSource.slice(0, skillMain).replace(/^\/\/!/gm, "//");
const renderer = new NativeRenderer({ artifactRoot, librarySource });
const cases = [];

// A unique knob color reveals the actual native ink without changing geometry.
const knobStyle = '.part_style(Part::Knob, style().background(Color::rgb(255, 0, 255)))';
function knobFootprint(pixels) {
  let left = pixels.width, top = pixels.height, right = -1, bottom = -1;
  for (let y = 0; y < pixels.height; y++) {
    for (let x = 0; x < pixels.width; x++) {
      const i = (y * pixels.width + x) * 4;
      if (pixels.rgba[i] !== 255 || pixels.rgba[i + 1] !== 0 || pixels.rgba[i + 2] !== 255) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  assert.ok(right >= left && bottom >= top, "native slider knob must be visible");
  return [right - left + 1, bottom - top + 1];
}
async function renderedKnob(source, theme) {
  const result = await renderer.render({ source, theme });
  assert.equal(result.ok, true, JSON.stringify(result));
  return knobFootprint(decodeNativePng(Buffer.from(result.image.split(",")[1], "base64")));
}
try {
  let original;
  for (const theme of ["light", "dark"]) {
    const result = await renderer.render({ source, theme });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.sourceHash, sha256(source));
    const png = Buffer.from(result.image.split(",")[1], "base64");
    const pixels = decodeNativePng(png);
    assert.equal(pixels.width, 640);
    assert.equal(pixels.height, 400);
    assert.ok(new Set(pixels.rgba).size > 16, "native preview has visible content");
    await fs.writeFile(path.join(artifactRoot, `forms-${theme}.png`), png);
    cases.push({ name: `typed-binding-slots-lazy-${theme}`, pixels: sha256(pixels.rgba) });
    if (theme === "light") original = pixels.rgba;
    const reference = await renderedKnob(`use rs_lvgl_ui::prelude::*;
fn view(_: &Theme) -> View<()> {
    column([slider(0, 100, 50)${knobStyle}]).padding(32)
}`, theme);
    for (const value of [50, 0, 25, 75, 100]) {
      const marked = source.replace("let speed = 50;", `let speed = ${value};`)
        .replace('.key(Key::Named("speed"))', `${knobStyle}.key(Key::Named("speed"))`);
      const footprint = await renderedKnob(marked, theme);
      assert.deepEqual(footprint, reference, `${theme} speed ${value}: native slider knob is clipped`);
      cases.push({ name: `complete-slider-knob-${theme}-${value}`, footprint });
      const recipe = skillView
        .replace('.key(Key::Named("speed"))', `${knobStyle}.key(Key::Named("speed"))`);
      const skillKnob = await renderedKnob(`${recipe}
fn view(_: &Theme) -> View<()> {
    fields(&FanSettings { speed: ${value}, enabled: true, name: "Desk fan".into() }).map(|_| ())
}`, theme);
      assert.deepEqual(skillKnob, reference, `${theme} skill form ${value}: native slider knob is clipped`);
      cases.push({ name: `complete-skill-form-knob-${theme}-${value}`, footprint: skillKnob });
    }
    const clipped = await renderedKnob(source.replace(".padding(12)", ".padding(0)")
      .replace('.key(Key::Named("speed"))', `${knobStyle}.key(Key::Named("speed"))`), theme);
    assert.notDeepEqual(clipped, reference, "zero-padding negative control must expose clipped knob ink");
    cases.push({ name: `detect-clipped-knob-control-${theme}`, footprint: clipped });
    const controlsReference = await renderedKnob(`use rs_lvgl_ui::prelude::*;
fn view(_: &Theme) -> View<()> {
    column([slider(0, 100, 50).width(px(240)).height(px(16))${knobStyle}]).padding(32)
}`, theme);
    for (const value of [0, 50, 100]) {
      const marked = controlsSource.replace("slider(0, 100, 64)", `slider(0, 100, ${value})${knobStyle}`);
      const footprint = await renderedKnob(marked, theme);
      assert.deepEqual(footprint, controlsReference, `${theme} controls example ${value}: native slider knob is clipped`);
      cases.push({ name: `complete-controls-example-knob-${theme}-${value}`, footprint });
    }
  }
  const edited = await renderer.render({ source: source.replace("let speed = 50;", "let speed = 25;") });
  assert.equal(edited.ok, true, JSON.stringify(edited));
  assert.notEqual(sha256(decodeNativePng(Buffer.from(edited.image.split(",")[1], "base64")).rgba), sha256(original));
  cases.push({ name: "model-value-changes-native-pixels" });
  const invalid = await renderer.render({ source: source.replace("typed::switch(binding(true, |_: bool| ()))", 'typed::switch(binding(true, |_: bool| ())).placeholder("wrong widget")') });
  assert.equal(invalid.kind, "compile");
  assert.ok(invalid.diagnostics.some((item) => item.code === "E0277" && item.message.includes("Text")));
  cases.push({ name: "wrong-typed-property-rejected-by-rustc" });
  assert.equal(await identity(), before, "development native inputs changed during acceptance");
  await fs.writeFile(path.join(artifactRoot, "results.json"), JSON.stringify({
    status: "passed", librarySource, sourceIdentity: before, snippetHash: sha256(source), cases,
    limits: "Native snapshots and compiler diagnostics; online subset interpreter and device acceptance are separate.",
  }, null, 2) + "\n");
  console.log(`Passed ${cases.length} composition native Playground cases. Images: ${artifactRoot}`);
} finally { await renderer.close(); }
