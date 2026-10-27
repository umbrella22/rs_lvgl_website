import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { websiteRoot, repositoryRoot, libraryRoot } from "./paths.mjs";
export { websiteRoot, repositoryRoot, libraryRoot } from "./paths.mjs";
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

export class ProcessFailure extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// Wait for the whole process group to stop before another request can write source.
export function runProcess(
  command,
  args,
  {
    cwd,
    env = process.env,
    signal,
    timeout = 120_000,
    maxOutput = 4 * 1024 * 1024,
  } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new ProcessFailure("cancelled", "Render cancelled."));
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let length = 0;
    let failure;
    function stop(kind, message) {
      if (failure) return;
      failure = new ProcessFailure(kind, message);
      if (child.pid) {
        try {
          if (process.platform === "win32") child.kill("SIGKILL");
          else process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") failure = error;
        }
      }
    }
    const abort = () => stop("cancelled", "Render cancelled.");
    const timer = setTimeout(
      () => stop("timeout", `${command} exceeded ${timeout / 1000}s.`),
      timeout,
    );
    signal?.addEventListener("abort", abort, { once: true });
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
    for (const [stream, append] of [
      [
        child.stdout,
        (text) => {
          stdout += text;
        },
      ],
      [
        child.stderr,
        (text) => {
          stderr += text;
        },
      ],
    ]) {
      stream.on("data", (chunk) => {
        length += chunk.length;
        if (length > maxOutput)
          stop("output", "Process output exceeded the preview limit.");
        else append(chunk.toString());
      });
    }
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (code) => {
      cleanup();
      if (failure) reject(failure);
      else resolve({ code, stdout, stderr });
    });
  });
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, bytes) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length);
  name.copy(result, 4);
  bytes.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, bytes])), bytes.length + 8);
  return result;
}

export function encodePng(width, height, rgba) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 4_000_000 ||
    rgba.length !== width * height * 4
  ) {
    throw new Error("Invalid native RGBA dimensions or byte length.");
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const rows = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1)
    rgba.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function validateRenderRequest(value) {
  if (!value || typeof value.source !== "string" || !value.source.trim())
    throw new Error("Source must be a non-empty Rust string.");
  if (Buffer.byteLength(value.source) > 64 * 1024)
    throw new Error("Rust source must fit within 64 KiB.");
  const { width = 640, height = 400, theme = "light" } = value;
  if (
    !Number.isInteger(width) ||
    width < 240 ||
    width > 960 ||
    !Number.isInteger(height) ||
    height < 160 ||
    height > 720
  ) {
    throw new Error(
      "Preview dimensions must be integer pixels: width 240–960, height 160–720.",
    );
  }
  if (!["light", "dark"].includes(theme))
    throw new Error("Theme must be light or dark.");
  return { source: value.source, width, height, theme };
}

export function compilerDiagnostics(output) {
  const diagnostics = [];
  for (const line of output.split("\n")) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.reason !== "compiler-message") continue;
    const message = record.message;
    const sourceSpans = message.spans.filter((span) =>
      /(?:^|[/\\])view\.rs$/.test(span.file_name),
    );
    if (!sourceSpans.length && message.level !== "error") continue;
    const span = sourceSpans.find((item) => item.is_primary) ?? sourceSpans[0];
    diagnostics.push({
      level: message.level,
      message: message.message,
      code: message.code?.code,
      ...(span && {
        line: span.line_start,
        column: span.column_start,
        endLine: span.line_end,
        endColumn: span.column_end,
      }),
      notes: message.children.map((child) => child.message),
    });
  }
  return diagnostics;
}

export class NativeRenderer {
  constructor({
    artifactRoot = path.join(repositoryRoot, "target/rspress-playground"),
    compileTimeout = 120_000,
    runTimeout = 5_000,
  } = {}) {
    this.name = `lvgl-preview-${randomUUID()}`;
    this.directory = path.join(artifactRoot, "sessions", this.name);
    this.target = path.join(artifactRoot, "build");
    this.compileTimeout = compileTimeout;
    this.runTimeout = runTimeout;
    this.pending = Promise.resolve();
    this.sequence = 0;
  }

  async prepare(signal) {
    if (this.prepared) return;
    await fs.mkdir(path.join(this.directory, "src"), { recursive: true });
    const manifest = `[package]\nname = "${this.name}"\nversion = "0.0.0"\nedition = "2021"\n\n[workspace]\n\n[dependencies]\nrs_lvgl = { path = ${JSON.stringify(path.join(libraryRoot, "rs_lvgl"))}, default-features = false, features = ["alloc"] }\nrs_lvgl_ui = { path = ${JSON.stringify(path.join(libraryRoot, "rs_lvgl_ui"))} }\n`;
    await fs.writeFile(path.join(this.directory, "Cargo.toml"), manifest);
    await fs.copyFile(
      path.join(websiteRoot, "playground/runner.rs"),
      path.join(this.directory, "src/main.rs"),
    );
    const result = await runProcess(
      "cargo",
      [
        "generate-lockfile",
        "--offline",
        "--manifest-path",
        path.join(this.directory, "Cargo.toml"),
      ],
      { cwd: repositoryRoot, signal, timeout: this.compileTimeout },
    );
    if (result.code !== 0) throw new ProcessFailure("toolchain", result.stderr);
    this.prepared = true;
  }

  render(input, { signal } = {}) {
    const request = validateRenderRequest(input);
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const job = this.pending
      .catch(() => {})
      .then(() => this.perform(request, controller.signal));
    this.pending = job;
    return job.finally(() => signal?.removeEventListener("abort", abort));
  }

  async perform(request, signal) {
    const started = performance.now();
    const sourceHash = sha256(request.source);
    try {
      if (signal.aborted)
        throw new ProcessFailure("cancelled", "Render cancelled.");
      await this.prepare(signal);
      if (signal.aborted)
        throw new ProcessFailure("cancelled", "Render cancelled.");
      const outputDirectory = path.join(
        this.directory,
        `render-${++this.sequence}`,
      );
      await fs.mkdir(outputDirectory);
      await fs.writeFile(
        path.join(this.directory, "src/view.rs"),
        request.source,
      );
      const env = { ...process.env, CARGO_TARGET_DIR: this.target };
      const build = await runProcess(
        "cargo",
        [
          "build",
          "--offline",
          "--locked",
          "--manifest-path",
          path.join(this.directory, "Cargo.toml"),
          "--message-format=json",
        ],
        { cwd: repositoryRoot, env, signal, timeout: this.compileTimeout },
      );
      const diagnostics = compilerDiagnostics(build.stdout);
      if (build.code !== 0)
        return {
          ok: false,
          kind: "compile",
          sourceHash,
          diagnostics: diagnostics.length
            ? diagnostics
            : [{ level: "error", message: build.stderr.slice(-4000) }],
        };
      const executable = path.join(
        this.target,
        "debug",
        this.name + (process.platform === "win32" ? ".exe" : ""),
      );
      const rawPath = path.join(outputDirectory, "snapshot.rgba");
      const execution = await runProcess(executable, [], {
        cwd: outputDirectory,
        env: {
          ...env,
          RS_LVGL_PREVIEW_WIDTH: String(request.width),
          RS_LVGL_PREVIEW_HEIGHT: String(request.height),
          RS_LVGL_PREVIEW_THEME: request.theme,
          RS_LVGL_PREVIEW_OUTPUT: rawPath,
        },
        signal,
        timeout: this.runTimeout,
        maxOutput: 1024 * 1024,
      });
      if (execution.code !== 0) {
        const error = execution.stderr.match(
          /RS_LVGL_PREVIEW_ERROR:([^:]+):([^\n]*)/,
        );
        return {
          ok: false,
          kind: error?.[1] ?? "runtime",
          sourceHash,
          diagnostics: [
            {
              level: "error",
              message:
                error?.[2] ??
                (execution.stderr.slice(-4000) ||
                  `Native process exited with ${execution.code}.`),
            },
          ],
        };
      }
      const stat = await fs.stat(rawPath);
      if (stat.size < 8 || stat.size > 16_000_008)
        throw new Error("Native snapshot exceeds the supported image size.");
      const data = await fs.readFile(rawPath);
      const width = data.readUInt32LE(0);
      const height = data.readUInt32LE(4);
      const png = encodePng(width, height, data.subarray(8));
      return {
        ok: true,
        sourceHash,
        width,
        height,
        image: `data:image/png;base64,${png.toString("base64")}`,
        imageHash: sha256(png),
        diagnostics,
        elapsedMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      return {
        ok: false,
        sourceHash,
        kind: error.kind ?? "runtime",
        diagnostics: [
          {
            level: "error",
            message: String(error.message)
              .replaceAll(this.directory, "<playground>")
              .replaceAll(repositoryRoot, "<checkout>"),
          },
        ],
      };
    }
  }

  async close() {
    this.controller?.abort();
    await this.pending.catch(() => {});
    await fs.rm(this.directory, { recursive: true, force: true });
  }
}
