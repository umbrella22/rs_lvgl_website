import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useLang, withBase } from "@rspress/core/runtime";
import diagrams from "../diagrams/artifacts.json";
import "./ArchifyDiagram.css";

type DiagramId = "data-model" | "message-flow" | "build-path" | "capabilities";

const descriptions: Record<DiagramId, { zh: string; en: string }> = {
  "data-model": {
    zh: "Settings 持有业务状态，Message 表达输入意图，App 描述更新规则。Ui 借用应用处理消息，并把 View 描述协调成原生对象。",
    en: "Settings owns application state, Message expresses input intent, and App defines update rules. Ui borrows the app to process messages and reconcile View descriptions into native objects.",
  },
  "message-flow": {
    zh: "从开关的 1/0 原生值开始，沿消息入队、Ui::drain、状态更新和新 View 追踪一次交互。回调不会直接修改 App。",
    en: "Follow a switch's native 1/0 value through the queue, Ui::drain, state update and new View. The callback does not directly update App.",
  },
  "build-path": {
    zh: "同一份有效配置分流到 C 编译和 bindgen；原生库、绑定与能力元数据共同决定应用可用的 Rust API。",
    en: "One effective configuration feeds C compilation and bindgen. The native library, bindings and capability metadata determine the Rust API available to the application.",
  },
  capabilities: {
    zh: "按描述与状态、可选能力、平台接入阅读。树的连线表示职责归属；具体 feature 的选择仍以本页的配置表为准。",
    en: "Read the tree as views and state, optional capabilities, and platform integration. Lines mean responsibility; use the feature tables below for exact selection.",
  },
};

export function ArchifyDiagram({ id }: { id: DiagramId }) {
  const locale = useLang() === "en" ? "en" : "zh";
  const en = locale === "en";
  const diagram = diagrams.figures.find((item) => item.id === id && item.locale === locale);
  if (!diagram) throw new Error(`Unknown diagram: ${locale}/${id}`);
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState("light");
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.classList.contains("rp-dark") ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  const url = withBase(`/diagrams/${locale}/${id}.html?theme=${theme}`);
  const style = { "--diagram-ratio": `${diagram.viewBox[0]} / ${diagram.viewBox[1] + 20}` } as CSSProperties;
  return (
    <figure className="archify-figure" data-diagram={id} style={style}>
      <figcaption className="archify-figure__heading">
        <div>
          <span className="archify-figure__eyebrow">{en ? "VISUAL EXPLAINER" : "图解"} / {diagram.type.toUpperCase()}</span>
          <strong>{diagram.title}</strong>
        </div>
        <button type="button" onClick={() => setOpen(true)}>{en ? "Explore diagram" : "交互探索"} <span aria-hidden="true">↗</span></button>
      </figcaption>
      <iframe className="archify-figure__overview" src={`${url}&overview=1`} loading="lazy" title={diagram.title} tabIndex={-1} aria-hidden="true" />
      <div className="archify-figure__caption">
        <p>{descriptions[id][locale]}</p>
        <a href={url} target="_blank" rel="noreferrer">{en ? "Open full-size diagram" : "独立窗口查看全图"} ↗</a>
      </div>
      <dialog ref={dialog} className="archify-reader" aria-labelledby={titleId} onClose={() => setOpen(false)}>
        <div className="archify-reader__heading">
          <strong id={titleId}>{diagram.title}</strong>
          <button type="button" onClick={() => dialog.current?.close()}>{en ? "Close diagram" : "关闭图解"} <span aria-hidden="true">×</span></button>
        </div>
        {open && <iframe
          src={url}
          title={diagram.title}
          allow="clipboard-write; fullscreen"
          onLoad={(event) => {
            // Let the reader close its own selection or menu first.
            event.currentTarget.contentDocument?.addEventListener("keydown", (key) => {
              if (key.key === "Escape" && !key.defaultPrevented) {
                key.preventDefault();
                dialog.current?.close();
              }
            });
          }}
        />}
      </dialog>
    </figure>
  );
}
