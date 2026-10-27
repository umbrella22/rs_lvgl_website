import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useLang, withBase } from "@rspress/core/runtime";
import playgroundExamples from "../playground/generated/apps.json";
import { InteractivePreview } from "./InteractivePreview";
import { RustEditor, type RustDiagnostic } from "./RustEditor";
import { useRustPlayground } from "./useRustPlayground";
import "./Playground.css";

type PaneLayout = "split" | "code" | "preview";
type IconName = "examples" | "code" | "preview" | "split" | "run" | "stop" | "reset" | "copy" | "check" | "settings" | "sun" | "moon" | "close";
const iconPaths: Record<IconName, ReactNode> = {
  examples: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M8 3v18M12 8h5M12 12h5M12 16h3" /></>,
  code: <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16" />,
  preview: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>,
  split: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></>,
  run: <path d="m8 5 11 7-11 7Z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  reset: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" /></>,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  moon: <path d="M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
};
function Icon({ name }: { name: IconName }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{iconPaths[name]}</svg>;
}

export function Playground({ children }: { children: ReactNode }) {
  const en = useLang() === "en";
  const lang = en ? "en" : "zh";
  const { preset, source, theme, size, auto, canRun, mode, connection, status, diagnostics, good,
    displayed, runtimeError, artifact, cancelRevision, stale, focusLine, labels,
    setFocusLine, setAuto, changeSource, changeTheme, changeSize, changeMode, reset, cancel, selectPreset,
    run, connect, onResult } = useRustPlayground({ en, syncUrl: true });
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [layout, setLayout] = useState<PaneLayout>("split");
  const [compact, setCompact] = useState(false);
  const [split, setSplit] = useState(55);
  const [dragging, setDragging] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const panes = useRef<HTMLDivElement>(null);
  const examplesButton = useRef<HTMLButtonElement>(null);
  const selected = playgroundExamples.find((item) => item.id === preset)!;
  const activeLayout = compact && layout === "split" ? "code" : layout;
  const hasError = Boolean(runtimeError) || diagnostics.some((item) => item.level === "error");
  const previewCaption = hasError || stale
    ? (en ? "Last successful preview" : "显示上次成功的预览")
    : (en ? "Click, drag, or use the keyboard. Esc leaves the preview." : "点击、拖动或使用键盘。Esc 退出预览焦点。");
  const copyLabel = copyState === "copied" ? (en ? "Copied" : "已复制") : copyState === "error"
    ? (en ? "Copy failed. Select the code to copy." : "复制失败，请在编辑器中选择代码复制。")
    : (en ? "Copy code" : "复制代码");

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = setTimeout(() => setCopyState("idle"), 3000);
    return () => clearTimeout(timeout);
  }, [copyState]);

  function showSource(line: number) {
    if (activeLayout === "preview") setLayout(compact ? "code" : "split");
    setFocusLine({ line, timestamp: Date.now() });
  }
  function resize(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || !panes.current) return;
    const bounds = panes.current.getBoundingClientRect();
    setSplit(Math.max(35, Math.min(65, (event.clientX - bounds.left) / bounds.width * 100)));
  }
  async function copyCode() {
    try { await navigator.clipboard.writeText(source); setCopyState("copied"); }
    catch { setCopyState("error"); }
  }
  function closeExamples() {
    setExamplesOpen(false);
    examplesButton.current?.focus();
  }

  return (
    <div className="playground">
      <header className="playground__intro">
        <div>{children}<p>{en ? "Edit a component. Try it live." : "改一段代码，试一下控件。"}</p></div>
        <a href={withBase(`${en ? "/en" : ""}/guide/browser-playground.html`)}>{en ? "Playground guide" : "使用说明"}<span aria-hidden="true">↗</span></a>
      </header>

      <div className="playground__workbench" data-dragging={dragging || undefined}>
        <div className="playground__toolbar">
          <div className="playground__project">
            <button className="playground__tool" ref={examplesButton} onClick={() => setExamplesOpen(!examplesOpen)} aria-expanded={examplesOpen} aria-controls="playground-examples">
              <Icon name="examples" /><span>{en ? "Examples" : "示例"}</span>
            </button>
            <span className="playground__breadcrumb" aria-hidden="true">/</span>
            <span className="playground__current" title={selected.title[lang]}>{selected.title[lang]}</span>
          </div>
          <div className="playground__actions">
            <label className="playground__auto"><input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} /><span>{en ? "Auto run" : "自动运行"}</span></label>
            <details className="playground__settings" onKeyDown={(event) => {
              if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); }
            }}>
              <summary className="playground__tool playground__icon-button" aria-label={en ? "Run settings" : "运行设置"} title={en ? "Run settings" : "运行设置"}><Icon name="settings" /></summary>
              <div className="playground__settings-content">
                <label>{en ? "Run mode" : "运行方式"}
                  <select aria-label={en ? "Run mode" : "运行方式"} value={mode} onChange={(event) => changeMode(event.target.value as "browser" | "local")}>
                    <option value="browser">{en ? "Browser" : "浏览器"}</option>
                    <option value="local">{en ? "Local Rust compiler" : "本地 Rust 编译器"}</option>
                  </select>
                </label>
                <p>{mode === "browser"
                  ? (en ? "Supported Rust syntax runs here. Your source stays in the browser." : "支持的 Rust 语法直接在这里运行，源码留在浏览器内。")
                  : (en ? "The local compiler runs Rust with your account privileges. Use trusted snippets." : "本地编译器以当前用户权限运行 Rust，请使用可信代码。")}</p>
                <a href={withBase(`${en ? "/en" : ""}/guide/browser-playground.html`)}>{en ? "Supported syntax →" : "查看支持范围 →"}</a>
              </div>
            </details>
            <button className="playground__run" disabled={status !== "running" && !canRun} onClick={() => status === "running" ? cancel() : void run()}>
              <Icon name={status === "running" ? "stop" : "run"} />{status === "running" ? (en ? "Cancel" : "取消") : (en ? "Run" : "运行")}
            </button>
          </div>
        </div>

        {mode === "local" && connection !== "online" && <div className="playground__connect" role="status">
          <div><strong>{connection === "connecting" ? (en ? "Connecting to the local compiler…" : "正在连接本地编译服务…") : (en ? "Start the local compiler" : "启动本地编译服务")}</strong>
            <p>{en ? "Run at the repository root, then open the address printed in your terminal." : "在仓库根目录运行，然后打开终端显示的地址。"}</p>
            <code>npm --prefix website run playground</code></div>
          <button className="playground__tool" onClick={() => void connect()}>{en ? "Reconnect" : "重新连接"}</button>
        </div>}

        <div className="playground__body" data-examples={examplesOpen || undefined}>
          <aside className="playground__examples" id="playground-examples" hidden={!examplesOpen} aria-label={en ? "Examples" : "示例"} onKeyDown={(event) => { if (event.key === "Escape") closeExamples(); }}>
            <div className="playground__examples-heading"><span>{en ? "EXPLORE" : "选择示例"}</span><button className="playground__tool playground__icon-button" aria-label={en ? "Close examples" : "关闭示例"} onClick={closeExamples}><Icon name="close" /></button></div>
            <nav>{playgroundExamples.map((item, index) => <button key={item.id} aria-current={preset === item.id ? "true" : undefined} onClick={() => { if (item.id !== preset) selectPreset(item.id); if (compact) closeExamples(); }}>
              <span className="playground__example-number">{String(index + 1).padStart(2, "0")}</span><span>{item.title[lang]}</span>
            </button>)}</nav>
            <a href={withBase(`${en ? "/en" : ""}/guide/declarative-ui.html`)}>{en ? "Learn to arrange widgets" : "学习布局与组件"}<span aria-hidden="true">↗</span></a>
          </aside>

          <div className="playground__main">
            <div className="playground__viewbar">
              <div className="playground__layouts" role="group" aria-label={en ? "Workspace layout" : "工作区布局"}>
                {(["split", "code", "preview"] as const).map((value) => <button key={value} className={value === "split" ? "playground__split-choice" : undefined} aria-pressed={activeLayout === value} onClick={() => setLayout(value)}>
                  <Icon name={value} /><span>{value === "split" ? (en ? "Split" : "分栏") : value === "code" ? (en ? "Code" : "代码") : (en ? "Preview" : "预览")}</span>
                </button>)}
              </div>
              <span className="playground__runtime"><span className="status-dot" />{mode === "browser" ? (en ? "In your browser" : "在浏览器中运行") : (en ? "Local compiler" : "本地编译器")}</span>
            </div>

            <div className="playground__panes" ref={panes} data-layout={activeLayout} style={{ "--playground-split": `${split}%` } as CSSProperties}>
              <section id="playground-code" className="playground__editor" hidden={activeLayout === "preview"} aria-label={en ? "Rust editor" : "Rust 编辑器"}>
                <div className="playground__pane-title">
                  <span className="playground__file"><Icon name="code" />view.rs<span className="playground__modified" hidden={source === selected.source} aria-label={en ? "Modified example" : "示例已修改"} /></span>
                  <div className="playground__pane-actions"><kbd>⌘ / Ctrl ↵</kbd>
                    <button className="playground__tool playground__icon-button" aria-label={copyLabel} title={copyLabel} onClick={() => void copyCode()}><Icon name={copyState === "copied" ? "check" : "copy"} /></button>
                    <button className="playground__tool playground__icon-button" aria-label={en ? "Reset" : "重置"} title={en ? "Reset example" : "重置示例"} onClick={reset}><Icon name="reset" /></button>
                  </div>
                </div>
                <RustEditor value={source} onChange={changeSource} onRun={() => void run()} diagnostics={diagnostics} focusLine={focusLine} />
              </section>

              <div className="playground__divider" hidden={activeLayout !== "split"} role="separator" tabIndex={0} aria-label={en ? "Resize code and preview" : "调整代码与预览宽度"} aria-orientation="vertical" aria-controls="playground-code playground-preview" aria-valuemin={35} aria-valuemax={65} aria-valuenow={Math.round(split)} aria-valuetext={`${Math.round(split)}% ${en ? "code" : "代码"}`}
                onPointerDown={(event) => { if (event.button !== 0 || !event.isPrimary) return; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }}
                onPointerMove={resize} onLostPointerCapture={() => setDragging(false)}
                onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
                onDoubleClick={() => setSplit(55)}
                onKeyDown={(event) => { const values: Record<string, number> = { ArrowLeft: split - 2, ArrowRight: split + 2, Home: 35, End: 65 }; if (event.key in values) { event.preventDefault(); setSplit(Math.max(35, Math.min(65, values[event.key]))); } }} />

              <section id="playground-preview" className="playground__preview" hidden={activeLayout === "code"} aria-label={en ? "Native preview" : "原生预览"}>
                <div className="playground__pane-title"><span className="playground__preview-title"><Icon name="preview" />{en ? "Preview" : "预览"}</span>
                  <div className="playground__pane-actions">
                    <select aria-label={en ? "Display size" : "显示尺寸"} value={size} onChange={(event) => changeSize(event.target.value)}><option value="640x400">640 × 400</option><option value="480x320">480 × 320</option><option value="800x480">800 × 480</option></select>
                    <button className="playground__tool playground__icon-button" aria-label={en ? "Dark UI theme" : "深色界面"} aria-pressed={theme === "dark"} title={en ? "Toggle preview theme" : "切换预览主题"} onClick={() => changeTheme(theme === "light" ? "dark" : "light")}><Icon name={theme === "light" ? "sun" : "moon"} /></button>
                  </div>
                </div>
                <div className="playground__canvas"><div className="playground__device" style={{ maxWidth: displayed?.width ?? 640 }}><InteractivePreview cancelRevision={cancelRevision} artifact={artifact} en={en} onResult={onResult} /></div>
                  <p className="playground__image-label">{previewCaption}</p>
                </div>
              </section>
            </div>
          </div>
        </div>

        <div className={`playground__status ${hasError ? "playground__status--error" : ""}`} role="status">
          <span className="playground__status-result"><span className={`playground__status-light ${status === "running" ? "playground__status-light--running" : ""}`} /><strong>{runtimeError ? labels[runtimeError.kind] ?? runtimeError.kind : labels[status] ?? status}</strong>
            {good && !runtimeError && status === "success" && <span>{good.result.elapsedMs} ms</span>}</span>
          <span className="playground__status-meta">{source.split("\n").length} {en ? "lines" : "行"}<span>Rust</span></span>
        </div>
        {(diagnostics.length > 0 || runtimeError) && <div className="playground__diagnostics" role="alert">
          {[...diagnostics, ...(runtimeError ? [{ level: "error", message: runtimeError.message } as RustDiagnostic] : [])].map((item, index) => <div key={index} className="playground__diagnostic">
            {item.line && <button onClick={() => showSource(item.line!)}>view.rs:{item.line}:{item.column}</button>}
            <strong>{item.code ? `${item.code}: ` : ""}{item.message}</strong>{item.notes?.map((note, i) => <p key={i}>{note}</p>)}
          </div>)}
        </div>}
        <span className="playground__copy-feedback" role="status">{copyState !== "idle" ? copyLabel : ""}</span>
      </div>
      <footer className="playground__notes"><span>{en ? "Each run starts fresh. Your last working preview stays when an edit fails." : "每次运行从初始状态开始。修改出错时，保留上次成功的预览。"}</span>
        <a href={withBase(`${en ? "/en" : ""}/guide/browser-playground.html`)}>{en ? "Supported Rust syntax" : "支持的 Rust 语法"}<span aria-hidden="true">↗</span></a>
      </footer>
    </div>
  );
}
