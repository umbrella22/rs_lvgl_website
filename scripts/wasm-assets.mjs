import fs from "node:fs/promises";
import path from "node:path";
import { repositoryRoot, websiteRoot, sha256, runProcess } from "./playground-native.mjs";
import { libraryRoot, sourceInputPath } from "./paths.mjs";

export const wasmRoot = path.join(websiteRoot, "docs/public/wasm");
export const wasmFiles = ["studio.mjs", "studio.wasm"];
export async function wasmInputs() {
  const result = await runProcess("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: libraryRoot });
  if (result.code) throw new Error(result.stderr);
  const names = result.stdout.split("\0").filter((name) =>
    (/^rs_lvgl(?:_sys|_ui|_codegen)?\//.test(name) && !/\/(?:tests|examples)\//.test(name) && /\.(?:rs|c|h|cpp|hpp|toml)$/.test(name)) ||
    /^rs_lvgl_ui\/examples\/(?:studio\.rs|studio\/(?!audit\.rs).*\.rs|assets\/)/.test(name),
  );
  const site = await runProcess("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "wasm"], { cwd: repositoryRoot });
  if (site.code) throw new Error(site.stderr);
  names.push(...site.stdout.split("\0").filter(Boolean).map((name) => `website/${name}`));
  names.push("Cargo.toml", ".cargo/config.toml", "website/wasm/Cargo.lock", "website/scripts/paths.mjs", "website/scripts/build-wasm.mjs", "website/scripts/wasm-assets.mjs", "website/scripts/emscripten.mjs");
  const sources = [];
  for (const name of [...new Set(names)].sort()) sources.push([name, sha256(await fs.readFile(sourceInputPath(name)))]);
  return { digest: sha256(JSON.stringify(sources)), sources };
}

export async function verifyWasm(root = wasmRoot, expected) {
  expected ??= await wasmInputs();
  const excerpts = JSON.parse(await fs.readFile(path.join(websiteRoot, "wasm/sources.json"), "utf8"));
  if (JSON.stringify(excerpts) !== JSON.stringify(await studioSources())) throw new Error("Studio source excerpts are stale");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
  if (manifest.schema !== 1 || manifest.sourceDigest !== expected.digest)
    throw new Error("WebAssembly source changed. Run npm run wasm:build.");
  for (const name of wasmFiles) {
    const bytes = await fs.readFile(path.join(root, name));
    if (sha256(bytes) !== manifest.outputs[name]?.sha256 || bytes.length !== manifest.outputs[name]?.bytes)
      throw new Error(`WebAssembly artifact differs: ${name}`);
  }
  const bytes = await fs.readFile(path.join(root, "studio.wasm"));
  if (!WebAssembly.validate(bytes)) throw new Error("Invalid WebAssembly module");
  return manifest;
}

export async function studioSources() {
  const pagesFile = "rs_lvgl_ui/examples/studio/pages.rs";
  const nativeFile = "rs_lvgl_ui/examples/studio/native.rs";
  const pageText = await fs.readFile(sourceInputPath(pagesFile), "utf8");
  const names = ["overview", "controls", "input", "data", "layout", "media", "canvas_page", "composition"];
  const sources = names.map((name) => {
    const start = pageText.indexOf(`fn ${name}(`);
    if (start < 0) throw new Error(`Missing studio function: ${name}`);
    const next = pageText.indexOf("\nfn ", start);
    return { file: pagesFile, line: pageText.slice(0, start).split("\n").length, source: pageText.slice(start, next < 0 ? undefined : next).trim() };
  });
  sources.push({ file: nativeFile, line: 1, source: await fs.readFile(sourceInputPath(nativeFile), "utf8") });
  return sources;
}
