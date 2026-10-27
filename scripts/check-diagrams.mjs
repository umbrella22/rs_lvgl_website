#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { originalDiagram, readerAssets } from './diagram-reader-assets.mjs';
import { verifyDiagramPorts } from './diagram-geometry.mjs';
import { sourceInputPath } from './paths.mjs';
export { repositoryRoot } from './paths.mjs';

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const readRepositoryFile = (name) => fs.readFile(sourceInputPath(name));
const readJson = async (name) => JSON.parse(await readRepositoryFile(name));

export async function verifySources(evidence, read = readRepositoryFile) {
  if (evidence.schemaVersion !== 1 || evidence.basis !== 'working-tree-content') {
    throw new Error('Unsupported diagram source evidence.');
  }
  for (const [id, source] of Object.entries(evidence.sources)) {
    const bytes = await read(source.path);
    if (sha256(bytes) !== source.fileSha256) throw new Error(`Diagram source changed: ${source.path} (${id}). Review its claims and regenerate the affected diagrams.`);
    const lines = bytes.toString().split(/\r?\n/);
    if (!Number.isInteger(source.line) || !Number.isInteger(source.endLine) || source.line < 1 || source.endLine < source.line || source.endLine > lines.length) {
      throw new Error(`Invalid diagram source range: ${id}.`);
    }
    const excerpt = `${lines.slice(source.line - 1, source.endLine).join('\n')}\n`;
    if (excerpt !== source.excerpt || sha256(excerpt) !== source.excerptSha256) throw new Error(`Diagram source excerpt changed: ${id}.`);
  }
}

export async function verifyFigure(figure, artifact, evidence, read = readRepositoryFile) {
  if (!artifact) throw new Error(`Missing diagram artifact: ${figure.locale}/${figure.id}.`);
  const bytes = await read(figure.candidate);
  if (sha256(bytes) !== artifact.candidateSha256) throw new Error(`Diagram candidate changed: ${figure.candidate}. Run Archify finalize and diagrams:sync.`);
  const candidate = JSON.parse(bytes);
  if (candidate.diagram_type !== figure.type || candidate.meta.locale !== (figure.locale === 'en' ? 'en' : 'zh-CN')) throw new Error(`Diagram type/locale mismatch: ${figure.id}.`);
  for (const node of candidate.types ?? candidate.nodes) {
    const refs = evidence.claims[figure.id]?.[node.id];
    if (!refs?.length || refs.some((id) => !evidence.sources[id])) throw new Error(`Missing diagram source evidence: ${figure.id}/${node.id}.`);
  }
  if (!['validate', 'deliver', 'check', 'browser-check'].every((gate) => artifact.gates[gate] === 'pass')) throw new Error(`Diagram acceptance incomplete: ${figure.id}.`);
  const html = await read(figure.published);
  if (sha256(html) !== artifact.htmlSha256) throw new Error(`Diagram HTML changed: ${figure.published}. Restore or regenerate the checked artifact.`);
  const original = originalDiagram(html.toString(), await readerAssets(read));
  if (sha256(original) !== artifact.normalizedArchifyHtmlSha256) throw new Error(`Original Archify HTML changed: ${figure.published}.`);
  verifyDiagramPorts(original, figure.type);
  if (artifact.title !== candidate.meta.title || artifact.type !== candidate.diagram_type) throw new Error(`Diagram metadata changed: ${figure.id}.`);
}

export async function checkDiagrams() {
  const [catalog, artifacts, evidence] = await Promise.all([
    readJson('website/diagrams/catalog.json'),
    readJson('website/diagrams/artifacts.json'),
    readJson('website/diagrams/source-evidence.json'),
  ]);
  await verifySources(evidence);
  if (sha256(JSON.stringify(evidence)) !== artifacts.evidenceSha256) throw new Error('Diagram evidence changed. Review the source claims and synchronize checked artifacts.');
  const expected = ['data-model', 'message-flow', 'build-path', 'capabilities'].flatMap((id) => ['zh', 'en'].map((locale) => `${locale}/${id}`)).sort();
  for (const [name, figures] of [['catalog', catalog.figures], ['artifacts', artifacts.figures]]) {
    const keys = figures.map((f) => `${f.locale}/${f.id}`).sort();
    if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error(`Incomplete bilingual diagram ${name}.`);
  }
  for (const figure of catalog.figures) {
    await verifyFigure(figure, artifacts.figures.find((item) => item.id === figure.id && item.locale === figure.locale), evidence);
  }
  return catalog.figures.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Verified ${await checkDiagrams()} source-backed diagrams in both languages.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
