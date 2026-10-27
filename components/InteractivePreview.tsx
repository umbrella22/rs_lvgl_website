import { useEffect, useRef, useState } from "react";
import { withBase } from "@rspress/core/runtime";

export interface PreviewError {
  kind: string;
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export interface InteractiveArtifact {
  source?: string;
  sourceHash: string;
  width: number;
  height: number;
  theme: string;
  module?: string;
  wasm?: string;
  moduleUrl?: string;
  wasmUrl?: string;
}

interface Session {
  worker: Worker;
  timer?: ReturnType<typeof setTimeout>;
  animation?: number;
  lastTime: number;
  ready: boolean;
}

interface Props {
  artifact: InteractiveArtifact;
  en: boolean;
  cancelRevision?: number;
  onResult: (error?: PreviewError, running?: InteractiveArtifact) => void;
}

export function InteractivePreview({ artifact, en, onResult, cancelRevision = 0 }: Props) {
  const cancelPending = useRef<() => void>(() => {});
  const lastCancel = useRef(cancelRevision);
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useRef<Session | null>(null);
  const sessions = useRef(new Set<Session>());
  const result = useRef(onResult);
  result.current = onResult;
  const [messages, setMessages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [restart, setRestart] = useState(0);
  const keys = useRef(new Set<number>());
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);

  function stop(session: Session) {
    clearTimeout(session.timer);
    cancelAnimationFrame(session.animation ?? 0);
    session.worker.onmessage = null;
    session.worker.onerror = null;
    // Termination also releases the worker's Wasm memory when user code blocks.
    session.worker.terminate();
    sessions.current.delete(session);
    if (active.current === session) active.current = null;
  }

  useEffect(() => () => {
    for (const session of sessions.current) stop(session);
  }, []);

  useEffect(() => {
    if (lastCancel.current !== cancelRevision) {
      lastCancel.current = cancelRevision;
      cancelPending.current();
    }
  }, [cancelRevision]);

  useEffect(() => {
    const controller = new AbortController();
    let pending: Session | undefined;
    setLoading(true);
    cancelPending.current = () => {
      controller.abort();
      if (pending && !pending.ready) stop(pending);
      setLoading(false);
    };
    async function start() {
      const module = artifact.module ?? await read(artifact.moduleUrl!, false) as string;
      const wasm = artifact.wasm
        ? Uint8Array.from(atob(artifact.wasm), (char) => char.charCodeAt(0)).buffer
        : await read(artifact.wasmUrl!, true) as ArrayBuffer;
      if (controller.signal.aborted) return;
      const worker = new Worker(withBase("/component-runtime/playground-worker.mjs"), { type: "module" });
      const session: Session = { worker, ready: false, lastTime: 0 };
      pending = session;
      sessions.current.add(session);
      function fail(kind: string, message: string, detail?: PreviewError) {
        stop(session);
        setLoading(false);
        result.current({ ...detail, kind, message }, artifact);
      }
      function watchdog() {
        session.timer = setTimeout(() => fail("timeout", en
          ? "The component did not return within 5 seconds. Check app(), view() and update() for blocking code."
          : "组件在 5 秒内没有返回。请检查 app()、view() 和 update() 中是否有阻塞代码。"), 5000);
      }
      function next(now: number) {
        if (active.current !== session) return;
        const elapsed = session.lastTime ? Math.min(100, Math.max(0, Math.round(now - session.lastTime))) : 16;
        session.lastTime = now;
        watchdog();
        worker.postMessage({ type: "frame", elapsed });
      }
      worker.onmessage = ({ data }) => {
        clearTimeout(session.timer);
        if (data.type === "error") { fail(data.kind, data.message, data); return; }
        if (data.type !== "frame") return;
        const element = canvas.current;
        if (!element) return;
        if (!session.ready) {
          for (const other of sessions.current) if (other !== session) stop(other);
          session.ready = true;
          active.current = session;
          keys.current.clear();
          pointer.current = null;
          element.width = artifact.width;
          element.height = artifact.height;
          setLoading(false);
          result.current(undefined, artifact);
        }
        if (data.pixels) element.getContext("2d", { alpha: false })?.putImageData(
          new ImageData(new Uint8ClampedArray(data.pixels), artifact.width, artifact.height), 0, 0,
        );
        setMessages(data.messages);
        session.animation = requestAnimationFrame(next);
      };
      worker.onerror = (event) => fail("runtime", event.message);
      watchdog();
      worker.postMessage({ type: "init", module, wasm, width: artifact.width, height: artifact.height, theme: artifact.theme, source: artifact.source }, [wasm]);
    }
    async function read(url: string, binary: boolean) {
      const response = await fetch(withBase(url), {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      });
      if (!response.ok) throw new Error(`Preview download: HTTP ${response.status}`);
      return binary ? response.arrayBuffer() : response.text();
    }
    void start().catch((error: Error) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      result.current({ kind: "runtime", message: error.message }, artifact);
    });
    return () => {
      controller.abort();
      if (pending && !pending.ready) stop(pending);
    };
  }, [artifact, restart]);

  function send(data: object) { active.current?.worker.postMessage(data); }
  function release() {
    const current = pointer.current;
    if (current) send({ type: "pointer", x: current.x, y: current.y, pressed: 0 });
    pointer.current = null;
    for (const key of keys.current) send({ type: "key", key, pressed: 0 });
    keys.current.clear();
  }
  function position(event: React.PointerEvent<HTMLCanvasElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      id: event.pointerId,
      x: Math.max(0, Math.min(event.currentTarget.width - 1, Math.floor((event.clientX - box.left) * event.currentTarget.width / box.width))),
      y: Math.max(0, Math.min(event.currentTarget.height - 1, Math.floor((event.clientY - box.top) * event.currentTarget.height / box.height))),
    };
  }
  function nativeKey(event: React.KeyboardEvent) {
    const special: Record<string, number> = { ArrowUp: 17, ArrowDown: 18, ArrowRight: 19, ArrowLeft: 20, Delete: 127, Backspace: 8, Enter: 10, Home: 2, End: 3 };
    if (event.key === "Tab") return event.shiftKey ? 11 : 9;
    return special[event.key] ?? ([...event.key].length === 1 ? event.key.codePointAt(0) : undefined);
  }
  return <div className="interactive-preview">
    <canvas ref={canvas} width={640} height={400} tabIndex={0} data-testid="interactive-preview"
      aria-label={en ? "Interactive LVGL component. Escape leaves keyboard focus." : "可交互的 LVGL 组件，Esc 退出键盘焦点。"}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = position(event);
        send({ type: "pointer", ...pointer.current, pressed: 1 });
      }}
      onPointerMove={(event) => {
        if (pointer.current?.id !== event.pointerId) return;
        pointer.current = position(event);
        send({ type: "pointer", ...pointer.current, pressed: 1 });
      }}
      onPointerUp={(event) => { if (pointer.current?.id === event.pointerId) release(); }}
      onPointerCancel={(event) => { if (pointer.current?.id === event.pointerId) release(); }}
      onLostPointerCapture={(event) => { if (pointer.current?.id === event.pointerId) release(); }} onBlur={release}
      onKeyDown={(event) => {
        if (event.key === "Escape") { release(); event.currentTarget.blur(); return; }
        if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) return;
        const key = nativeKey(event);
        if (key === undefined) return;
        event.preventDefault(); keys.current.add(key); send({ type: "key", key, pressed: 1 });
      }}
      onKeyUp={(event) => {
        const key = nativeKey(event);
        if (key === undefined || !keys.current.has(key)) return;
        event.preventDefault(); keys.current.delete(key); send({ type: "key", key, pressed: 0 });
      }} />
    <div className="interactive-preview__state">
      <span aria-live="polite">{loading ? (en ? "Starting component…" : "正在启动组件…") : (en ? `Rust messages: ${messages}` : `已处理 ${messages} 条 Rust 消息`)}</span>
      <button onClick={() => setRestart((value) => value + 1)}>{en ? "Restart preview" : "重启预览"}</button>
    </div>
  </div>;
}
