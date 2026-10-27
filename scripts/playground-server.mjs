import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WasmCompiler } from "./playground-wasm.mjs";
import {
  NativeRenderer,
  websiteRoot,
  validateRenderRequest,
} from "./playground-native.mjs";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function json(response, code, value) {
  response.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function tokenMatches(actual, expected) {
  return (
    typeof actual === "string" &&
    /^[a-f0-9]{64}$/.test(actual) &&
    actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  );
}

async function readJson(request) {
  if (
    request.headers["content-type"]?.split(";")[0].trim() !== "application/json"
  )
    throw new Error("Expected application/json.");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 512 * 1024) throw new Error("Request exceeds 512 KiB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

export async function startServer({
  port = 4173,
  base = "/",
  directory = path.join(websiteRoot, "doc_build"),
  renderer = new NativeRenderer(),
  compiler = new WasmCompiler(),
} = {}) {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))
    throw new Error(
      "Base must be a slash-delimited site path, such as / or /rs-lvgl/.",
    );
  const root = await fs.realpath(directory);
  const token = randomBytes(32).toString("hex");
  let actualPort;
  const server = http.createServer(async (request, response) => {
    try {
      const host = request.headers.host;
      if (
        ![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(host)
      )
        return json(response, 403, { error: "Invalid local host." });
      const origin = `http://${host}`;
      const url = new URL(request.url, origin);
      if (!url.pathname.startsWith(base))
        return json(response, 404, { error: "Outside the site base path." });
      const route = url.pathname.slice(base.length - 1);
      if (route.startsWith("/__playground/")) {
        if (
          request.headers["sec-fetch-site"] === "cross-site" ||
          (request.headers.origin && request.headers.origin !== origin)
        )
          return json(response, 403, { error: "Same-origin requests only." });
        if (route === "/__playground/session" && request.method === "GET")
          return json(response, 200, {
            token,
            engine: "Rust / LVGL 9.6",
            schema: 2,
          });
        if (!["/__playground/render", "/__playground/compile"].includes(route) || request.method !== "POST")
          return json(response, 404, { error: "Unknown playground endpoint." });
        if (
          request.headers.origin !== origin ||
          !tokenMatches(request.headers["x-playground-token"], token)
        )
          return json(response, 403, {
            error: "A valid local session is required.",
          });
        let input;
        try {
          input = validateRenderRequest(await readJson(request));
        } catch (error) {
          return json(response, 400, { error: error.message });
        }
        const controller = new AbortController();
        response.on("close", () => {
          if (!response.writableFinished) controller.abort();
        });
        const result = route === "/__playground/compile"
          ? await compiler.compile(input, { signal: controller.signal })
          : await renderer.render(input, { signal: controller.signal });
        if (!response.destroyed) json(response, 200, result);
        return;
      }
      if (!["GET", "HEAD"].includes(request.method))
        return json(response, 405, { error: "Method not allowed." });
      let decoded;
      try {
        decoded = decodeURIComponent(route);
      } catch {
        return json(response, 400, { error: "Invalid URL encoding." });
      }
      if (decoded.includes("\0") || decoded.includes("\\"))
        return json(response, 400, { error: "Invalid asset path." });
      const requested = path.resolve(root, "." + decoded);
      if (requested !== root && !requested.startsWith(root + path.sep))
        return json(response, 403, { error: "Invalid asset path." });
      let file;
      for (const candidate of [
        requested,
        requested + ".html",
        path.join(requested, "index.html"),
      ]) {
        try {
          const real = await fs.realpath(candidate);
          if (
            real.startsWith(root + path.sep) &&
            (await fs.stat(real)).isFile()
          ) {
            file = real;
            break;
          }
        } catch (error) {
          if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
        }
      }
      if (!file)
        return json(response, 404, { error: "Page or asset not found." });
      response.writeHead(200, {
        "Content-Type":
          contentTypes[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(
        request.method === "HEAD" ? undefined : await fs.readFile(file),
      );
    } catch (error) {
      if (!response.destroyed && !response.headersSent)
        json(response, 500, {
          error: "The local preview failed. See the terminal for details.",
        });
      console.error(error.message);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      actualPort = server.address().port;
      resolve();
    });
  });
  return {
    url: `http://127.0.0.1:${actualPort}${base}`,
    async close() {
      const stopped = new Promise((resolve) => server.close(resolve));
      await renderer.close();
      await compiler.close();
      server.closeAllConnections();
      await stopped;
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  function option(name, fallback) {
    const index = args.indexOf(name);
    return index === -1 ? fallback : args[index + 1];
  }
  const port = Number(option("--port", "4173"));
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Port must be an integer from 1 to 65535.");
  const service = await startServer({ port, base: option("--base", process.env.RSPRESS_BASE || "/rs_lvgl_website/") });
  console.log(`Native Rust/LVGL playground: ${service.url}playground`);
  console.log(
    "Local trusted Rust only. Code runs with this account; this is not a sandbox. Ctrl+C stops the service.",
  );
  let closing = false;
  async function close() {
    if (!closing) {
      closing = true;
      await service.close();
    }
  }
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
