import { useLang } from "@rspress/core/runtime";
import examples from "../playground/generated/apps.json";
import { LiveExample } from "./LiveExample";

export function AppExample({ id }: { id: string }) {
  const lang = useLang() === "en" ? "en" : "zh";
  const example = examples.find((item) => item.id === id);
  if (!example) throw new Error(`Unknown application example: ${id}`);
  return <LiveExample id={id} title={example.title[lang]} />;
}
