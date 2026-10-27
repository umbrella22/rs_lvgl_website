#!/usr/bin/env node
// Copy only finalized artifacts. Source evidence is authored and reviewed separately.
import fs from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot, sha256, readRepositoryFile, verifySources } from './check-diagrams.mjs';
import { adaptDiagram, normalizeDiagramWhitespace, readerAssets } from './diagram-reader-assets.mjs';
import { verifyDiagramPorts } from './diagram-geometry.mjs';
import { sourceInputPath } from './paths.mjs';

const catalog = JSON.parse(await readRepositoryFile('website/diagrams/catalog.json'));
const evidence = JSON.parse(await readRepositoryFile('website/diagrams/source-evidence.json'));
await verifySources(evidence);
const reader = await readerAssets(readRepositoryFile);
const figures = [];
const pending = [];
for (const figure of catalog.figures) {
  const generated = path.join(repositoryRoot, figure.generated);
  const folder = path.dirname(generated);
  const stem = path.basename(generated, '.html');
  const html = await fs.readFile(generated);
  const candidate = await readRepositoryFile(figure.candidate);
  const folders = [folder];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('review-')) folders.push(path.join(folder, entry.name));
  }
  const receipts = [];
  for (const dir of folders) {
    try { receipts.push(JSON.parse(await fs.readFile(path.join(dir, `${stem}.finalize-summary.json`), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const receipt = receipts.find((r) => r.ok && r.artifact.sha256 === sha256(html) && r.specification.sha256 === sha256(candidate) && ['validate', 'deliver', 'check', 'browser-check'].every((gate) => r.gates[gate] === 'pass'));
  if (!receipt) throw new Error(`No passing finalize receipt for ${figure.locale}/${figure.id}.`);
  verifyDiagramPorts(html.toString(), figure.type);
  const svg = html.toString().match(/<svg[^>]*aria-labelledby="archify-diagram-title[^>]*>/)?.[0];
  const match = svg?.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!match) throw new Error(`No canonical diagram viewBox: ${figure.id}.`);
  const published = adaptDiagram(html.toString(), reader);
  figures.push({ id: figure.id, locale: figure.locale, type: figure.type, title: figure.title, viewBox: [Number(match[1]), Number(match[2])], candidateSha256: sha256(candidate), archifyHtmlSha256: sha256(html), normalizedArchifyHtmlSha256: sha256(normalizeDiagramWhitespace(html.toString())), htmlSha256: sha256(published), gates: receipt.gates });
  pending.push({ destination: sourceInputPath(figure.published), html: published });
}
// Verify the whole batch before changing any published diagram.
for (const item of pending) {
  await fs.mkdir(path.dirname(item.destination), { recursive: true });
  await fs.writeFile(item.destination, item.html);
}
await fs.writeFile(sourceInputPath('website/diagrams/artifacts.json'), `${JSON.stringify({ schemaVersion: 1, generator: 'archify 3.1.0', evidenceSha256: sha256(JSON.stringify(evidence)), figures }, null, 2)}\n`);
console.log(`Synchronized ${figures.length} verified diagrams.`);
