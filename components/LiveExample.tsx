import { useEffect, useId, useRef, useState } from "react";
import { useLang, withBase } from "@rspress/core/runtime";
import { CodeBlockRuntime } from "@rspress/core/theme";
import examples from "../playground/generated/apps.json";
import { InteractivePreview } from "./InteractivePreview";
import { RustEditor } from "./RustEditor";
import { useRustPlayground } from "./useRustPlayground";
import "./LiveExample.css";

function ExampleWorkspace({ id, en }: { id: string; en: boolean }) {
  const {
    source, canRun, status, diagnostics, good, runtimeError, artifact, cancelRevision,
    stale, focusLine, labels, setFocusLine, changeSource, reset, cancel, run, onResult,
  } = useRustPlayground({ id, en, autoRun: false });
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [source]);
  const failed = Boolean(runtimeError) || !["ready", "running", "success", "cancelled"].includes(status);
  let caption = en ? "Bundled interactive example" : "内置交互示例";
  if (stale || failed) {
    caption = en ? "Last successful preview · run to apply changes" : "上次成功画面 · 运行后应用修改";
  } else if (good) {
    caption = en ? "Your interface" : "你修改的界面";
  }

  async function copySource() {
    try { await navigator.clipboard.writeText(source); setCopied(true); }
    catch { setCopied(false); }
  }

  return <>
    <div className="live-example__toolbar">
      <span className="live-example__filename"><span className="file-dot" />{id}.rs</span>
      <div className="live-example__actions">
        <button type="button" onClick={() => void copySource()}>{copied ? (en ? "Copied" : "已复制") : (en ? "Copy" : "复制")}</button>
        <button type="button" onClick={reset}>{en ? "Reset" : "重置"}</button>
        {status === "running"
          ? <button type="button" className="docs-button docs-button--quiet" onClick={cancel}>{en ? "Cancel" : "取消"}</button>
          : <button type="button" className="docs-button" disabled={!canRun} onClick={() => void run()} title={en ? "Run Rust (⌘/Ctrl + Enter)" : "运行 Rust（⌘/Ctrl + Enter）"}>{en ? "Run" : "运行"}<span aria-hidden="true">→</span></button>}
      </div>
    </div>
    <div className="live-example__panes">
      <div className="live-example__editor">
        <RustEditor value={source} onChange={changeSource} onRun={() => void run()} diagnostics={diagnostics} focusLine={focusLine} />
      </div>
      <div className="live-example__preview">
        <div className="preview-label"><span className="status-dot" />LVGL / WASM<span>640 × 400</span></div>
        <InteractivePreview cancelRevision={cancelRevision} artifact={artifact} en={en} onResult={onResult} />
        <p className="live-example__caption">{caption}</p>
      </div>
    </div>
    <div className={`live-example__status${failed ? " live-example__status--error" : ""}`} role="status">
      <span>{runtimeError ? labels[runtimeError.kind] ?? runtimeError.kind : labels[status] ?? status}</span>
      {good && !runtimeError && status === "success" && <span>{good.result.elapsedMs} ms</span>}
    </div>
    {(diagnostics.length > 0 || runtimeError) && <div className="playground__diagnostics">
      {runtimeError && <div className="playground__diagnostic">{runtimeError.message}</div>}
      {diagnostics.map((item, index) => <div className="playground__diagnostic" key={`${index}-${item.message}`}>
        {item.line && <button type="button" onClick={() => setFocusLine({ line: item.line!, timestamp: Date.now() })}>
          {en ? "Line" : "第"} {item.line}{en ? "" : " 行"}{item.column ? `:${item.column}` : ""}
        </button>}
        <strong>{item.code ? `${item.code}: ` : ""}{item.message}</strong>
        {item.notes?.map((note, noteIndex) => <p key={noteIndex}>{note}</p>)}
      </div>)}
    </div>}
    <div className="live-example__support">
      <a href={withBase(`${en ? "/en" : ""}/guide/browser-playground.html`)}>{en ? "Supported Rust syntax" : "支持哪些 Rust 语法"}</a>
    </div>
  </>;
}

export function LiveExample({ id, title, description, image }: {
  id: string; title: string; description?: string; image?: string;
}) {
  const en = useLang() === "en";
  const headingId = useId();
  const figure = useRef<HTMLElement>(null);
  const [active, setActive] = useState(false);
  const example = examples.find((item) => item.id === id);
  if (!example) throw new Error(`Unknown application example: ${id}`);

  useEffect(() => {
    if (!figure.current) return;
    if (!("IntersectionObserver" in window)) { setActive(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setActive(true); observer.disconnect(); }
    }, { rootMargin: "160px" });
    observer.observe(figure.current);
    return () => observer.disconnect();
  }, []);

  return <figure className="live-example" data-example={id} ref={figure} aria-labelledby={headingId}>
    <figcaption className="live-example__heading">
      <strong id={headingId}>{title}</strong>
      {description && <span>{description}</span>}
    </figcaption>
    {active ? <ExampleWorkspace key={id} id={id} en={en} /> : <div className="live-example__panes">
      <div className="live-example__fallback-code"><CodeBlockRuntime lang="rust" code={example.source} title={`${id}.rs`} lineNumbers /></div>
      <div className="live-example__preview">
        {image && <img src={withBase(image)} width="640" height="400" loading="lazy" alt={title} />}
        <p className="live-example__caption">{en ? "Loading the interactive example…" : "正在加载交互示例…"}</p>
      </div>
    </div>}
  </figure>;
}
