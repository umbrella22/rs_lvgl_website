import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLang, withBase } from "@rspress/core/runtime";
import { CodeBlockRuntime } from "@rspress/core/theme";
import sources from "../wasm/sources.json";

export function BrowserStudio({ children }: { children: ReactNode }) {
  const en = useLang() === "en";
  const escapeFocus = useRef<HTMLAnchorElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(900);
  const [page, setPage] = useState(0);
  const url = withBase(`/component-runtime/index.html?lang=${en ? "en" : "zh"}`);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "rs-lvgl-studio-escape") escapeFocus.current?.focus();
      if (event.data?.type === "rs-lvgl-studio-page" && Number.isInteger(event.data.page) && event.data.page >= 0 && event.data.page < sources.length)
        setPage(event.data.page);
      if (event.data?.type === "rs-lvgl-studio-height" && Number.isFinite(event.data.height) && event.data.height >= 200 && event.data.height <= 1500)
        setHeight(event.data.height);
    };
    window.addEventListener("message", receive);
    frame.current?.contentWindow?.postMessage({ type: "rs-lvgl-studio-measure" }, location.origin);
    return () => window.removeEventListener("message", receive);
  }, []);
  const requestSize = () => frame.current?.contentWindow?.postMessage({ type: "rs-lvgl-studio-measure" }, location.origin);
  const source = sources[page];
  return (
    <div className="browser-studio">
      <div className="browser-studio__intro">
        <div className="docs-home__eyebrow"><span className="status-dot" /> RUST + LVGL / WEBASSEMBLY</div>
        {children}
        <p>{en
          ? "Browse the categories in the studio sidebar and try the controls. The browser and desktop versions use the same Rust views."
          : "通过工作台侧栏切换分类，操作控件，查看布局和动画。浏览器版与桌面版使用同一套 Rust 视图。"}</p>
        <div className="browser-studio__links">
          <a ref={escapeFocus} href={url} target="_blank" rel="noreferrer">{en ? "Open in a separate tab ↗" : "独立窗口打开 ↗"}</a>
          <a href={withBase(`${en ? "/en" : ""}/playground.html`)}>{en ? "Edit an example →" : "在演练场修改示例 →"}</a>
        </div>
      </div>
      <iframe ref={frame} onLoad={requestSize} src={url} title={en ? "Interactive Rust and LVGL component studio" : "Rust 与 LVGL 交互组件工作台"} style={{ height }} allow="fullscreen" />
      <details className="browser-studio__source">
        <summary>{en ? "Rust source for the selected category" : "查看当前分类的 Rust 源码"} <span>{source.file}:{source.line}</span></summary>
        <p>{en ? "This excerpt is compiled into the preview above. Shared helpers and state live in studio.rs. Try supported UI code in the browser playground; use its optional local compiler for the full studio source." : "这段代码参与编译上方画面，共用的辅助函数与状态位于 studio.rs。可以在演练场中直接试写支持的 UI 代码；修改完整工作台源码时，使用其中的本地编译模式。"}</p>
        <CodeBlockRuntime key={page} lang="rust" code={source.source} title={`${source.file}:${source.line}`} lineNumbers />
      </details>
      <div className="browser-studio__notes">
        <p>{en ? "Nine categories include native controls, text and Pinyin input, charts, layouts, GIF/Lottie, canvas motion, dialogs, navigation and raw native widgets. Use the in-canvas sidebar to switch pages; the source excerpt follows your selection." : "九个分类覆盖基础控件、文本与拼音输入、图表、布局、GIF/Lottie、画布动画、对话框、导航和原生控件。通过画布内侧栏切换分类，下方源码会同步更新。"}</p>
        <p>{en ? "The studio is precompiled WebAssembly and works on static hosting. The playground supports browser editing for a documented Rust subset, with an optional local compiler for full Rust. The browser canvas demonstrates LVGL rendering and interaction; device drivers and physical displays are validated on their target hardware." : "组件工作台使用预编译 WebAssembly，静态网站也能运行。演练场支持在浏览器中修改一部分 Rust 语法，也提供可选的本地完整编译模式。浏览器画布展示 LVGL 的渲染与交互，设备驱动和物理屏幕仍在对应硬件上验证。"}</p>
      </div>
    </div>
  );
}
