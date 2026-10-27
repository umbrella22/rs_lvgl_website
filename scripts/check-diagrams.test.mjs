import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256, verifySources, verifyFigure } from './check-diagrams.mjs';
import { adaptDiagram, normalizeDiagramWhitespace, originalDiagram } from './diagram-reader-assets.mjs';
import { verifyDiagramPorts } from './diagram-geometry.mjs';

const nativeHtml = `<html><head></head><body><svg>
<g data-node-id="settings"><rect x="0" y="0" width="80" height="40" class="c-mask"/></g>
<g data-node-id="view"><rect x="160" y="80" width="80" height="40" class="c-mask"/></g>
<path data-edge-id="update" data-edge-from="settings" data-edge-to="view" data-composition-points="40,40;40,100;160,100"/>
</svg></body></html>`;

function fixture() {
  const source = Buffer.from('struct Settings { enabled: bool }\n');
  const candidate = Buffer.from(JSON.stringify({ diagram_type: 'class', meta: { locale: 'en', title: 'State' }, types: [{ id: 'settings' }] }));
  const reader = { css: Buffer.from('reader styles'), js: Buffer.from('reader defaults') };
  const html = Buffer.from(adaptDiagram(nativeHtml, reader));
  const files = new Map([['source.rs', source], ['candidate.json', candidate], ['diagram.html', html], ['website/docs/public/diagrams/reader.css', reader.css], ['website/docs/public/diagrams/reader.js', reader.js]]);
  const evidence = { schemaVersion: 1, basis: 'working-tree-content', sources: { state: { path: 'source.rs', line: 1, endLine: 1, fileSha256: sha256(source), excerptSha256: sha256(source), excerpt: source.toString() } }, claims: { 'data-model': { settings: ['state'] } } };
  const figure = { id: 'data-model', locale: 'en', type: 'class', candidate: 'candidate.json', published: 'diagram.html' };
  const artifact = { title: 'State', type: 'class', candidateSha256: sha256(candidate), archifyHtmlSha256: sha256(nativeHtml), normalizedArchifyHtmlSha256: sha256(nativeHtml), htmlSha256: sha256(html), gates: { validate: 'pass', deliver: 'pass', check: 'pass', 'browser-check': 'pass' } };
  return { files, evidence, figure, artifact, read: async (name) => files.get(name) };
}

test('accepts source ranges and a matching finalized diagram', async () => {
  const f = fixture();
  await verifySources(f.evidence, f.read);
  await verifyFigure(f.figure, f.artifact, f.evidence, f.read);
});

test('cleans blank style lines while preserving diagram text and multiline source strings', () => {
  const source = '<html><head><style>\n    \ntext { white-space: pre; }\n\t\n</style></head><body><text> keep </text><script>const text = ` keep\n    \n text `;</script></body></html>';
  const normalized = source.replace('\n    \n', '\n\n').replace('\n\t\n', '\n\n');
  assert.equal(normalizeDiagramWhitespace(source), normalized);
  const assets = { css: Buffer.from('styles'), js: Buffer.from('reader') };
  assert.equal(originalDiagram(adaptDiagram(source, assets), assets), normalized);
});

test('rejects changed source and independently changed excerpt identity', async () => {
  const f = fixture();
  f.files.set('source.rs', Buffer.from('struct Settings { enabled: u8 }\n'));
  await assert.rejects(verifySources(f.evidence, f.read), /Diagram source changed/);
  const g = fixture();
  g.evidence.sources.state.excerpt = 'wrong source\n';
  await assert.rejects(verifySources(g.evidence, g.read), /source excerpt changed/);
});

test('rejects stale candidates and modified generated HTML', async () => {
  const f = fixture();
  f.files.set('candidate.json', Buffer.from('{}'));
  await assert.rejects(verifyFigure(f.figure, f.artifact, f.evidence, f.read), /candidate changed/);
  const g = fixture();
  g.files.set('diagram.html', Buffer.from('altered output'));
  await assert.rejects(verifyFigure(g.figure, g.artifact, g.evidence, g.read), /HTML changed/);
});

test('rejects missing source coverage and skipped browser acceptance', async () => {
  const f = fixture();
  delete f.evidence.claims['data-model'].settings;
  await assert.rejects(verifyFigure(f.figure, f.artifact, f.evidence, f.read), /Missing diagram source evidence/);
  const g = fixture();
  g.artifact.gates['browser-check'] = 'skipped';
  await assert.rejects(verifyFigure(g.figure, g.artifact, g.evidence, g.read), /acceptance incomplete/);
});

test('rejects changed reader assets and independently altered native payloads', async () => {
  const f = fixture();
  f.files.set('website/docs/public/diagrams/reader.css', Buffer.from('changed styles'));
  await assert.rejects(verifyFigure(f.figure, f.artifact, f.evidence, f.read), /reader assets changed/);
  const g = fixture();
  const modified = Buffer.from(g.files.get('diagram.html').toString().replace('data-node-id="view"', 'data-node-id="other"'));
  g.files.set('diagram.html', modified);
  g.artifact.htmlSha256 = sha256(modified);
  await assert.rejects(verifyFigure(g.figure, g.artifact, g.evidence, g.read), /Original Archify HTML changed/);
});

test('requires midpoint attachment and a perpendicular approach at both ends', () => {
  assert.equal(verifyDiagramPorts(nativeHtml, 'dataflow'), 1);
  const tangential = nativeHtml.replace('40,40;40,100;160,100', '80,20;80,100;160,100');
  assert.throws(() => verifyDiagramPorts(tangential, 'dataflow'), /start runs along or into/);
  const offCenter = nativeHtml.replace('40,40;40,100;160,100', '40,40;40,91;160,91');
  assert.throws(() => verifyDiagramPorts(offCenter, 'dataflow'), /end misses the side midpoint/);
});
