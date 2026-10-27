import path from "node:path";
import { fileURLToPath } from "node:url";

export const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryRoot = websiteRoot;
export const libraryRoot = path.join(repositoryRoot, "source");

// Receipts retain their original logical source names across the repository move.
export function sourceInputPath(name) {
  return name.startsWith("website/")
    ? path.join(websiteRoot, name.slice("website/".length))
    : path.join(libraryRoot, name);
}
