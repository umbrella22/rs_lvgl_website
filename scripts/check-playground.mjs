import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NativeRenderer, repositoryRoot, websiteRoot, sha256 } from './playground-native.mjs';
import { nativeIdentity } from './render-examples.mjs';

const args = process.argv.slice(2);
const passesIndex = args.indexOf('--passes');
const passes = passesIndex < 0 ? 1 : Number(args[passesIndex + 1]);
if (!Number.isInteger(passes) || passes < 1 || passes > 3) throw new Error('Passes must be 1, 2 or 3.');
const directory = path.join(repositoryRoot, 'target/rspress-playground/acceptance');
await fs.mkdir(directory, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(websiteRoot, 'playground/generated/examples.json'), 'utf8'));
const records = [];
const identity = await nativeIdentity();
assert.equal(identity, manifest.nativeIdentity, 'Render the example manifest before native acceptance.');
const renderer = new NativeRenderer();
try {
  for (let pass = 1; pass <= passes; pass += 1) {
    const start = Date.now();
    const cases = [];
    for (const example of manifest.examples) {
      const result = await renderer.render({ source: example.source });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.sourceHash, sha256(example.source));
      assert.equal(result.imageHash, example.imageHash, `${example.id} differs from its native documentation figure`);
      cases.push(`${example.id}:matching-native-image`);
    }
    const original = manifest.examples[0].source;
    const changed = original.replace('Hello, LVGL', 'Edited Rust, real LVGL');
    const edited = await renderer.render({ source: changed });
    assert.equal(edited.ok, true, JSON.stringify(edited));
    assert.notEqual(edited.imageHash, manifest.examples[0].imageHash);
    assert.equal(edited.sourceHash, sha256(changed));
    cases.push('edit-updates-native-pixels');
    const compile = await renderer.render({ source: original.replace('label("Hello, LVGL")', 'missing_widget("Hello, LVGL")') });
    assert.equal(compile.kind, 'compile');
    assert.ok(compile.diagnostics.some((item) => item.code === 'E0425' && item.line === 5 && item.column > 0));
    cases.push('rustc-line-column-error');
    for (const [expression, expected] of [
      ['column([label("A").key(Key::Id(1)), label("B").key(Key::Id(1))])', 'DuplicateKey'],
      ['label("A").child(label("B"))', 'InvalidProperty'],
    ]) {
      const result = await renderer.render({ source: `use rs_lvgl_ui::prelude::*;\nfn view(_: &Theme) -> View<()> { ${expression} }` });
      assert.equal(result.kind, 'mount');
      assert.equal(result.diagnostics[0].message, expected);
      cases.push(`native-validation:${expected}`);
    }
    const looping = 'use rs_lvgl_ui::prelude::*;\nfn view(_: &Theme) -> View<()> { loop {} }';
    // Accelerate only the deliberate infinite-loop case. Valid views use the
    // same execution budget as the local service.
    const timeoutRenderer = new NativeRenderer({ runTimeout: 750 });
    try {
      const timedOut = await timeoutRenderer.render({ source: looping });
      assert.equal(timedOut.kind, 'timeout');
    } finally { await timeoutRenderer.close(); }
    cases.push('bounded-native-execution');
    const old = renderer.render({ source: looping });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const newest = renderer.render({ source: original });
    const [cancelled, recovered] = await Promise.all([old, newest]);
    assert.equal(cancelled.kind, 'cancelled');
    assert.equal(recovered.ok, true, JSON.stringify(recovered));
    assert.equal(recovered.imageHash, manifest.examples[0].imageHash);
    cases.push('superseded-request-and-recovery');
    const second = new NativeRenderer();
    try {
      const [one, two] = await Promise.all([renderer.render({ source: original }), second.render({ source: changed })]);
      assert.equal(one.imageHash, manifest.examples[0].imageHash);
      assert.equal(two.imageHash, edited.imageHash);
      assert.notEqual(one.sourceHash, two.sourceHash);
      cases.push('concurrent-consumers-output-isolation');
    } finally { await second.close(); }
    assert.equal(await nativeIdentity(), identity, 'Native inputs changed during acceptance.');
    records.push({ pass, start: new Date(start).toISOString(), elapsedMs: Date.now() - start, nativeIdentity: identity, runTimeout: renderer.runTimeout, negativeRunTimeout: 750, cases, status: 'passed' });
    await fs.writeFile(path.join(directory, 'results.json'), JSON.stringify(records, null, 2) + '\n');
    console.log(`Pass ${pass}: ${cases.length} native rendering, diagnostics, timeout, cancellation and isolation cases passed.`);
  }
} finally { await renderer.close(); }
