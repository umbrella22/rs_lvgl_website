import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { emscriptenEnvironment, wasmTarget, wasmBuildRoot } from "./emscripten.mjs";
import { repositoryRoot, websiteRoot, runProcess, ProcessFailure, compilerDiagnostics, validateRenderRequest, sha256 } from "./playground-native.mjs";
import { libraryRoot } from "./paths.mjs";

export class WasmCompiler {
  constructor({ compileTimeout = 120_000 } = {}) {
    this.name = `lvgl-interactive-${randomUUID()}`;
    this.directory = path.join(wasmBuildRoot, "sessions", this.name);
    this.compileTimeout = compileTimeout;
    this.pending = Promise.resolve();
  }

  async prepare(signal) {
    if (this.prepared) return;
    this.environment = await emscriptenEnvironment({ signal, timeout: this.compileTimeout });
    await fs.mkdir(path.join(this.directory, "src"), { recursive: true });
    const source = await fs.readFile(path.join(websiteRoot, "wasm/Cargo.toml"), "utf8");
    const manifest = source.replace('name = "rs-lvgl-browser-studio"', `name = "${this.name}"`)
      .replaceAll('path = "../source/', `path = "${libraryRoot}/`);
    await fs.writeFile(path.join(this.directory, "Cargo.toml"), manifest);
    const lock = await fs.readFile(path.join(websiteRoot, "wasm/Cargo.lock"), "utf8");
    await fs.writeFile(path.join(this.directory, "Cargo.lock"), lock.replace('name = "rs-lvgl-browser-studio"', `name = "${this.name}"`));
    await fs.copyFile(path.join(websiteRoot, "playground/browser.rs"), path.join(this.directory, "src/main.rs"));
    this.prepared = true;
  }

  compile(input, { signal } = {}) {
    const request = validateRenderRequest(input);
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const job = this.pending.catch(() => {}).then(() => this.perform(request, controller.signal));
    this.pending = job;
    return job.finally(() => signal?.removeEventListener("abort", abort));
  }

  async perform(request, signal) {
    const sourceHash = sha256(request.source);
    const started = performance.now();
    try {
      if (signal.aborted) throw new ProcessFailure("cancelled", "Compilation cancelled.");
      await this.prepare(signal);
      if (signal.aborted) throw new ProcessFailure("cancelled", "Compilation cancelled.");
      await fs.writeFile(path.join(this.directory, "src/view.rs"), request.source);
      const build = await runProcess("cargo", [
        "build", "--offline", "--locked", "--release", "--target", wasmTarget,
        "--manifest-path", path.join(this.directory, "Cargo.toml"), "--message-format=json",
      ], { cwd: repositoryRoot, env: this.environment.env, signal, timeout: this.compileTimeout });
      const diagnostics = compilerDiagnostics(build.stdout);
      if (build.code) return {
        ok: false, kind: "compile", sourceHash,
        diagnostics: diagnostics.length ? diagnostics : [{ level: "error", message: build.stderr.slice(-4000) }],
      };
      const built = path.join(wasmBuildRoot, wasmTarget, "release/deps", this.name.replaceAll("-", "_"));
      const module = await fs.readFile(`${built}.js`, "utf8");
      const bytes = await fs.readFile(`${built}.wasm`);
      if (!WebAssembly.validate(bytes)) throw new Error("Compiler produced invalid WebAssembly.");
      return {
        ok: true, sourceHash, module, wasm: bytes.toString("base64"), diagnostics,
        width: request.width, height: request.height, theme: request.theme,
        elapsedMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      return {
        ok: false, sourceHash, kind: error.kind ?? "toolchain",
        diagnostics: [{ level: "error", message: String(error.message)
          .replaceAll(this.directory, "<playground>").replaceAll(repositoryRoot, "<checkout>") }],
      };
    }
  }

  async close() {
    this.controller?.abort();
    await this.pending.catch(() => {});
    await fs.rm(this.directory, { recursive: true, force: true });
  }
}
