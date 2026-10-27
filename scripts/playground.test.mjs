import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { encodePng, runProcess, validateRenderRequest } from './playground-native.mjs';
import { startServer } from './playground-server.mjs';

test('PNG preserves RGBA channel values and scanline boundaries', () => {
  const pixels = Buffer.from([255, 0, 0, 255, 0, 128, 255, 64]);
  const png = encodePng(1, 2, pixels);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1);
  assert.equal(png.readUInt32BE(20), 2);
  const length = png.readUInt32BE(33);
  assert.equal(png.subarray(37, 41).toString(), 'IDAT');
  assert.deepEqual(inflateSync(png.subarray(41, 41 + length)), Buffer.from([0, 255, 0, 0, 255, 0, 0, 128, 255, 64]));
  assert.throws(() => encodePng(2, 2, pixels), /byte length/);
});

test('request validation rejects invalid dimensions and UTF-8 payloads without normalizing them', () => {
  assert.equal(validateRenderRequest({ source: 'fn view() {}' }).width, 640);
  for (const width of [0, 239, 961, 640.5, '640']) assert.throws(() => validateRenderRequest({ source: 'x', width }), /dimensions/);
  assert.throws(() => validateRenderRequest({ source: '界'.repeat(22_000) }), /64 KiB/);
  assert.throws(() => validateRenderRequest({ source: 'x', theme: 'sepia' }), /Theme/);
});

test('timeout kills a child and permits the next process to finish', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(() => {}, 100)'], { timeout: 80 }), (error) => error.kind === 'timeout');
  const next = await runProcess(process.execPath, ['-e', 'process.stdout.write("ready")']);
  assert.equal(next.stdout, 'ready');
});

test('aborted processes and excessive output terminate with distinct failures', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runProcess(process.execPath, ['-e', 'throw new Error("must not run")'], { signal: controller.signal }), (error) => error.kind === 'cancelled');
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(4096))'], { maxOutput: 128 }), (error) => error.kind === 'output');
});

test('loopback HTTP requires origin and token and confines static files to the base', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lvgl-preview-http-'));
  const site = path.join(temporary, 'site');
  await fs.mkdir(site);
  await fs.writeFile(path.join(site, 'index.html'), '<h1>Native playground</h1>');
  await fs.writeFile(path.join(temporary, 'outside.txt'), 'private fixture');
  await fs.symlink(path.join(temporary, 'outside.txt'), path.join(site, 'escape.txt'));
  const calls = [];
  const renderer = { async render(value) { calls.push(value); return { ok: true }; }, async close() {} };
  const compilations = [];
  const compiler = { async compile(value) { compilations.push(value); return { ok: true }; }, async close() {} };
  const server = await startServer({ port: 0, base: '/docs/', directory: site, renderer, compiler });
  const origin = new URL(server.url).origin;
  try {
    assert.equal((await fetch(server.url)).status, 200);
    assert.equal((await fetch(origin + '/')).status, 404);
    assert.equal((await fetch(server.url + 'escape.txt')).status, 404);
    assert.equal((await fetch(server.url + '%2e%2e%2foutside.txt')).status, 403);
    const session = await (await fetch(server.url + '__playground/session')).json();
    const body = JSON.stringify({ source: 'fn view() {}' });
    const endpoint = server.url + '__playground/render';
    const headers = { 'Content-Type': 'application/json', Origin: origin, 'X-Playground-Token': session.token };
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 403);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, Origin: 'https://unrelated.example' }, body })).status, 403);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, 'X-Playground-Token': 'é'.repeat(64) }, body })).status, 403);
    assert.equal((await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ source: 'x', width: 10000 }) })).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await fetch(endpoint, { method: 'POST', headers, body })).status, 200);
    assert.equal(calls.length, 1);
    assert.equal(session.schema, 2);
    const compileEndpoint = server.url + '__playground/compile';
    assert.equal((await fetch(compileEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 403);
    assert.equal((await fetch(compileEndpoint, { method: 'POST', headers: { ...headers, Origin: 'https://unrelated.example' }, body })).status, 403);
    assert.equal((await fetch(compileEndpoint, { method: 'POST', headers, body: JSON.stringify({ source: 'x', width: 10000 }) })).status, 400);
    assert.equal(compilations.length, 0);
    assert.equal((await fetch(compileEndpoint, { method: 'POST', headers, body })).status, 200);
    assert.equal(compilations.length, 1);
  } finally {
    await server.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
