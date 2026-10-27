import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const topics = [
  'getting-started', 'declarative-ui', 'components', 'input-and-events',
  'features', 'native-integration', 'ui-runtime', 'examples', 'troubleshooting', 'development',
];
const document = '---\ntitle: Guide\ndescription: A complete documentation test fixture.\n---\n\n# Guide\n';

async function fixture(t, { body = '', built = false, base = '/' } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rs-lvgl-docs-check-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const script = path.join(root, 'scripts/check-docs.mjs');
  await fs.mkdir(path.dirname(script), { recursive: true });
  await fs.copyFile(new URL('./check-docs.mjs', import.meta.url), script);

  async function write(relative, content) {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }

  for (const locale of ['zh', 'en']) {
    await write(`docs/${locale}/index.md`, document + body);
    await write(`docs/${locale}/_nav.json`, JSON.stringify([
      { text: 'Guide', link: '/guide/getting-started' },
    ]));
    await write(`docs/${locale}/guide/_meta.json`, JSON.stringify(
      topics.map((name) => ({ type: 'file', name, label: name })),
    ));
    for (const topic of topics) {
      await write(`docs/${locale}/guide/${topic}.md`, document);
    }
    if (built) {
      const prefix = locale === 'en' ? 'en/' : '';
      const alternate = locale === 'en' ? 'zh' : 'en';
      const alternatePrefix = base + (alternate === 'en' ? 'en/' : '');
      const html = `<html lang="${locale}"><head><meta name="description" content="Guide">` +
        `<link rel="alternate" hreflang="${alternate}" href="${alternatePrefix}guide/getting-started.html">` +
        `</head><body><h1 id="guide">Guide</h1><a href="${base}en/">English</a>` +
        `<a href="${base}${prefix}guide/getting-started.html">Start</a></body></html>`;
      await write(`doc_build/${prefix}index.html`, html);
      for (const topic of topics) {
        await write(`doc_build/${prefix}guide/${topic}.html`, html);
      }
      await write(`doc_build/static/search_index.${locale}.json`, JSON.stringify({
        content: 'Searchable documentation content. '.repeat(40),
      }));
    }
  }
  for (const asset of ['logo.svg', 'favicon.svg', 'images/studio-overview.png']) {
    await write(`docs/public/${asset}`, 'fixture');
    if (built) await write(`doc_build/${asset}`, 'fixture');
  }

  return {
    root,
    run() {
      const result = spawnSync(process.execPath, [script, ...(built ? ['--built'] : [])], {
        encoding: 'utf8', timeout: 10_000,
        env: { ...process.env, RSPRESS_BASE: base },
      });
      assert.ifError(result.error);
      return { status: result.status, output: result.stdout + result.stderr };
    },
  };
}

test('accepts complete source and built documentation', async (t) => {
  const site = await fixture(t, { built: true });
  const result = site.run();
  assert.equal(result.status, 0, result.output);
});

test('validates alternate language links under a configured site base', async (t) => {
  const site = await fixture(t, { built: true, base: '/rs-lvgl/' });
  const valid = site.run();
  assert.equal(valid.status, 0, valid.output);
  const file = path.join(site.root, 'doc_build/guide/getting-started.html');
  await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('/rs-lvgl/en/guide/', '/en/guide/'));
  const invalid = site.run();
  assert.equal(invalid.status, 1, invalid.output);
  assert.match(invalid.output, /English alternate link/);
});

test('rejects generated links that require an HTML extension fallback', async (t) => {
  const site = await fixture(t, { built: true });
  const file = path.join(site.root, 'doc_build/guide/components.html');
  const html = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, html.replace('</body>', '<a href="/guide/examples">Examples</a></body>'));
  const invalid = site.run();
  assert.equal(invalid.status, 1, invalid.output);
  assert.match(invalid.output, /built link.*guide\/components\.html.*\/guide\/examples/);
  await fs.writeFile(file, html.replace('</body>', '<a href="./examples.html?from=guide&amp;mode=browser#example">Examples</a></body>'));
  const valid = site.run();
  assert.equal(valid.status, 0, valid.output);
});

test('rejects generated navigation that escapes a configured site base', async (t) => {
  const site = await fixture(t, { built: true, base: '/rs-lvgl/' });
  const file = path.join(site.root, 'doc_build/en/index.html');
  const html = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, html.replace('</body>', '<a href="/en/guide/components.html">Components</a></body>'));
  const invalid = site.run();
  assert.equal(invalid.status, 1, invalid.output);
  assert.match(invalid.output, /built link.*en\/index\.html.*outside site base/);
  await fs.writeFile(file, html.replace('</body>', '<a href="/rs-lvgl/en/guide/components.html">Components</a><a href="https://example.com/docs">External</a></body>'));
  const valid = site.run();
  assert.equal(valid.status, 0, valid.output);
});

for (const locales of [['zh'], ['zh', 'en']]) {
  test(`rejects missing search indexes: ${locales.join(', ')}`, async (t) => {
    const site = await fixture(t, { built: true });
    for (const locale of locales) {
      await fs.unlink(path.join(site.root, `doc_build/static/search_index.${locale}.json`));
    }
    const result = site.run();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /search index/i);
  });
}

for (const marker of ['```', '~~~']) {
  test(`keeps ${marker} with trailing text inside its code block`, async (t) => {
    const site = await fixture(t, {
      body: `\n${marker}text\n${marker}still-code\n[example](./missing.md)\n${marker}\n`,
    });
    const result = site.run();
    assert.equal(result.status, 0, result.output);
  });
}

test('rejects a truly unterminated fence at its source line', async (t) => {
  const body = '\n```text\nexample\n';
  const site = await fixture(t, { body });
  const result = site.run();
  const line = (document + body).split('\n').indexOf('```text') + 1;
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(`docs/en/index.md:${line}: unterminated`), result.output);
});

test('reports source lines after frontmatter, comments and multiline inline code', async (t) => {
  const body = '\n<!--\nHidden comment\n-->\n\n`example\n[ignored](./not-a-link.md)`\n\n[broken](./missing.md)\n';
  const site = await fixture(t, { body });
  const result = site.run();
  const line = (document + body).split('\n').indexOf('[broken](./missing.md)') + 1;
  assert.equal(result.status, 1, result.output);
  assert.ok(result.output.includes(`docs/en/index.md:${line}: unresolved link`), result.output);
  assert.ok(!result.output.includes('not-a-link.md'), result.output);
});

test('still checks links whose labels contain inline code', async (t) => {
  const site = await fixture(t, { body: '\n[`Ui::drain`](./missing.md)\n' });
  const result = site.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /unresolved link "\.\/missing\.md"/);
});

test('accepts paired MDX home and guide routes in navigation and built output', async (t) => {
  const site = await fixture(t, { built: true });
  for (const locale of ['zh', 'en']) {
    for (const page of ['index', ...topics.map((topic) => `guide/${topic}`)]) {
      await fs.rename(path.join(site.root, `docs/${locale}/${page}.md`), path.join(site.root, `docs/${locale}/${page}.mdx`));
    }
  }
  const result = site.run();
  assert.equal(result.status, 0, result.output);
});

test('still rejects a missing translated route after an MDX migration', async (t) => {
  const site = await fixture(t);
  await fs.rename(path.join(site.root, 'docs/zh/guide/components.md'), path.join(site.root, 'docs/zh/guide/components.mdx'));
  const result = site.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /locale parity/);
});
