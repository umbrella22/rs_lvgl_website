import { useLang } from "@rspress/core/runtime";
import manifest from "../playground/generated/examples.json";
import { LiveExample } from "./LiveExample";

export const nativeExamples = manifest.examples;

export function NativeExample({ id }: { id: string }) {
  const lang = useLang() === "en" ? "en" : "zh";
  const example = nativeExamples.find((item) => item.id === id);
  if (!example) throw new Error(`Unknown native example: ${id}`);
  return <LiveExample id={id} title={example.title[lang]} description={example.description[lang]} image={example.image} />;
}
