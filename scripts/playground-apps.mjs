import fs from "node:fs/promises";
import path from "node:path";
import { examples } from "../playground/catalog.mjs";
import { websiteRoot, sha256 } from "./playground-native.mjs";

export async function playgroundApps() {
  const switchSource = await fs.readFile(path.join(websiteRoot, "playground/apps/switch.rs"), "utf8");
  const apps = [{
    id: "switch",
    title: { zh: "让开关响应点击", en: "Make a switch respond" },
    source: switchSource,
  }];
  const wrapper = await fs.readFile(path.join(websiteRoot, "playground/view-app.rs"), "utf8");
  for (const example of examples) {
    const source = await fs.readFile(path.join(websiteRoot, `playground/examples/${example.id}.rs`), "utf8");
    apps.push({ id: example.id, title: example.title, source: source + wrapper });
  }
  return apps.map((item) => ({ ...item, sourceHash: sha256(item.source) }));
}
