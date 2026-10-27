import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { examples } from "../playground/catalog.mjs";
import { libraryRoot, sourceInputPath } from "./paths.mjs";
import {
  NativeRenderer,
  websiteRoot,
  sha256,
  runProcess,
} from "./playground-native.mjs";

const generatedPath = path.join(
  websiteRoot,
  "playground/generated/examples.json",
);
const imageRoot = path.join(websiteRoot, "docs/public/playground");

export async function nativeIdentity() {
  const result = await runProcess(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: libraryRoot },
  );
  if (result.code) throw new Error(result.stderr);
  const inputs = result.stdout
    .split("\0")
    .filter(
      (name) =>
        /^rs_lvgl(?:_sys|_ui|_codegen)?\//.test(name) &&
        !/\/(?:tests|examples)\//.test(name) &&
        /\.(?:rs|c|h|cpp|hpp|toml)$/.test(name),
    );
  inputs.push(
    "Cargo.toml",
    "website/scripts/paths.mjs",
    "website/playground/runner.rs",
    "website/scripts/playground-native.mjs",
  );
  const hashes = [];
  for (const name of [...new Set(inputs)].sort())
    hashes.push([
      name,
      sha256(await fs.readFile(sourceInputPath(name))),
    ]);
  return sha256(JSON.stringify(hashes));
}

async function main() {
  const check = process.argv.includes("--check");
  const identity = await nativeIdentity();
  if (check) {
    const manifest = JSON.parse(await fs.readFile(generatedPath, "utf8"));
    if (manifest.nativeIdentity !== identity)
      throw new Error(
        "Native source changed. Run npm run examples:render.",
      );
    if (manifest.examples.length !== examples.length)
      throw new Error("Example catalog and rendered manifest differ.");
    for (const example of examples) {
      const entry = manifest.examples.find((item) => item.id === example.id);
      const source = await fs.readFile(
        path.join(websiteRoot, `playground/examples/${example.id}.rs`),
        "utf8",
      );
      if (
        !entry ||
        entry.source !== source ||
        entry.sourceHash !== sha256(source)
      )
        throw new Error(
          `${example.id}: source and figure differ; render examples again.`,
        );
      if (
        JSON.stringify(entry.title) !== JSON.stringify(example.title) ||
        JSON.stringify(entry.description) !==
          JSON.stringify(example.description)
      )
        throw new Error(
          `${example.id}: catalog metadata changed; render examples again.`,
        );
      if (
        entry.imageHash !==
        sha256(await fs.readFile(path.join(imageRoot, `${example.id}.png`)))
      )
        throw new Error(
          `${example.id}: image hash differs from the native receipt.`,
        );
    }
    console.log(
      `Verified ${examples.length} source/native-image pairs and their native input identity.`,
    );
    return;
  }
  await fs.mkdir(imageRoot, { recursive: true });
  await fs.mkdir(path.dirname(generatedPath), { recursive: true });
  const renderer = new NativeRenderer();
  const rendered = [];
  try {
    for (const example of examples) {
      const source = await fs.readFile(
        path.join(websiteRoot, `playground/examples/${example.id}.rs`),
        "utf8",
      );
      const result = await renderer.render({
        source,
        width: 640,
        height: 400,
        theme: "light",
      });
      if (!result.ok)
        throw new Error(`${example.id}: ${JSON.stringify(result)}`);
      await fs.writeFile(
        path.join(imageRoot, `${example.id}.png`),
        Buffer.from(result.image.split(",")[1], "base64"),
      );
      rendered.push({
        ...example,
        source,
        sourceHash: result.sourceHash,
        imageHash: result.imageHash,
        image: `/playground/${example.id}.png`,
        width: result.width,
        height: result.height,
      });
      console.log(
        `Rendered ${example.id}: ${result.width} × ${result.height}, ${result.elapsedMs} ms`,
      );
    }
    const manifest = {
      schema: 1,
      nativeIdentity: identity,
      renderer: "rs_lvgl_ui::Ui::snapshot / LVGL 9.6",
      viewport: { width: 640, height: 400, theme: "light" },
      examples: rendered,
    };
    await fs.writeFile(generatedPath, JSON.stringify(manifest, null, 2) + "\n");
  } finally {
    await renderer.close();
  }
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
