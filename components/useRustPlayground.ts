import { useEffect, useMemo, useRef, useState } from "react";
import { withBase } from "@rspress/core/runtime";
import examples from "../playground/generated/apps.json";
import type { InteractiveArtifact, PreviewError } from "./InteractivePreview";
import type { RustDiagnostic } from "./RustEditor";

type Mode = "browser" | "local";
interface RenderResult {
  ok: boolean;
  kind?: string;
  diagnostics: RustDiagnostic[];
  module?: string;
  wasm?: string;
  width?: number;
  height?: number;
  elapsedMs?: number;
  sourceHash: string;
}
interface Run { result: RenderResult; source: string; theme: string; size: string; mode: Mode }

export function useRustPlayground({ id = examples[0].id, en, syncUrl = false, autoRun = true }:
  { id?: string; en: boolean; syncUrl?: boolean; autoRun?: boolean }) {
  const initial = examples.find((example) => example.id === id);
  if (!initial) throw new Error(`Unknown application example: ${id}`);
  const [preset, setPreset] = useState(initial.id);
  const [source, setSource] = useState(initial.source);
  const [theme, setTheme] = useState("light");
  const [size, setSize] = useState("640x400");
  const [mode, setMode] = useState<Mode>("browser");
  const [auto, setAuto] = useState(autoRun);
  const [token, setToken] = useState<string>();
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">("offline");
  const [status, setStatus] = useState("ready");
  const [diagnostics, setDiagnostics] = useState<RustDiagnostic[]>([]);
  const [candidate, setCandidate] = useState<Run>();
  const [good, setGood] = useState<Run>();
  const [displayed, setDisplayed] = useState<InteractiveArtifact>();
  const [runtimeError, setRuntimeError] = useState<PreviewError>();
  const [focusLine, setFocusLine] = useState<{ line: number; timestamp: number }>();
  const [previewRevision, setPreviewRevision] = useState(0);
  const [cancelRevision, setCancelRevision] = useState(0);
  const request = useRef<AbortController | null>(null);
  const connectionRequest = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const started = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const runLatest = useRef<() => void>(() => {});
  const selected = examples.find((example) => example.id === preset)!;
  const canRun = mode === "browser" || Boolean(token);
  const artifact = useMemo<InteractiveArtifact>(() => {
    const runMode = candidate?.mode ?? mode;
    const base = candidate ? {
      sourceHash: candidate.result.sourceHash, width: candidate.result.width!,
      height: candidate.result.height!, theme: candidate.theme,
    } : { sourceHash: selected.sourceHash, width: 640, height: 400, theme: "light" };
    if (runMode === "browser") return { ...base, source: candidate?.source ?? selected.source,
      moduleUrl: "/playground-wasm/engine.mjs", wasmUrl: "/playground-wasm/engine.wasm" };
    return candidate ? { ...base, module: candidate.result.module, wasm: candidate.result.wasm }
      : { ...base, moduleUrl: `/playground-wasm/${selected.id}.mjs`, wasmUrl: `/playground-wasm/${selected.id}.wasm` };
  }, [candidate, selected, mode, previewRevision]);
  const pendingChanges = source !== (candidate?.source ?? selected.source)
    || theme !== (candidate?.theme ?? "light") || size !== (candidate?.size ?? "640x400");
  const stale = pendingChanges || Boolean(displayed && (displayed.sourceHash !== artifact.sourceHash
    || displayed.theme !== artifact.theme || displayed.width !== artifact.width || displayed.height !== artifact.height));

  async function connect() {
    connectionRequest.current?.abort();
    const controller = new AbortController();
    connectionRequest.current = controller;
    setConnection("connecting");
    try {
      const response = await fetch(withBase("/__playground/session"), { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Local service unavailable");
      const session = await response.json();
      if (session.schema !== 2 || typeof session.token !== "string") throw new Error("Unsupported local service");
      setToken(session.token); setConnection("online");
    } catch {
      if (controller.signal.aborted) return;
      setToken(undefined); setConnection("offline");
    }
  }
  useEffect(() => {
    if (mode === "local") void connect();
    else { connectionRequest.current?.abort(); setToken(undefined); }
    return () => connectionRequest.current?.abort();
  }, [mode]);
  useEffect(() => {
    if (syncUrl) {
      const requested = new URLSearchParams(window.location.search).get("example");
      const example = examples.find((item) => item.id === requested);
      if (example) { setPreset(example.id); setSource(example.source); }
    }
    return () => {
      revision.current += 1; request.current?.abort(); connectionRequest.current?.abort(); clearTimeout(debounce.current);
    };
  }, []);

  function invalidate() {
    revision.current += 1; request.current?.abort(); clearTimeout(debounce.current);
    setCancelRevision((value) => value + 1);
    setDiagnostics([]); setRuntimeError(undefined); setStatus("ready");
  }
  function changeSource(value: string) { if (value !== source) { invalidate(); setSource(value); } }
  function changeTheme(value: string) { if (value !== theme) { invalidate(); setTheme(value); } }
  function changeSize(value: string) { if (value !== size) { invalidate(); setSize(value); } }
  function changeMode(value: Mode) { if (value !== mode) { invalidate(); setMode(value); setCandidate(undefined); setGood(undefined); } }

  async function run() {
    if (!canRun) return;
    clearTimeout(debounce.current); request.current?.abort();
    const current = ++revision.current;
    const controller = new AbortController(); request.current = controller;
    started.current = performance.now();
    setStatus("running"); setDiagnostics([]); setRuntimeError(undefined);
    const [width, height] = size.split("x").map(Number);
    try {
      let result: RenderResult;
      if (mode === "browser") {
        const bytes = new TextEncoder().encode(source);
        if (bytes.length > 32_768) {
          setStatus("limit"); setDiagnostics([{ level: "error", line: 1, column: 1, message: en ? "Source limit: 32 KiB" : "源码最多 32 KiB。" }]); return;
        }
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        const sourceHash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        result = { ok: true, sourceHash, width, height, diagnostics: [] };
      } else {
        const response = await fetch(withBase("/__playground/compile"), {
          method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json", "X-Playground-Token": token! },
          body: JSON.stringify({ source, width, height, theme }),
        });
        if (!response.ok) { const failure = await response.json(); throw new Error(failure.error ?? `HTTP ${response.status}`); }
        result = await response.json();
      }
      if (revision.current !== current || controller.signal.aborted) return;
      setDiagnostics(result.diagnostics);
      if (result.ok) setCandidate({ result, source, theme, size, mode });
      else setStatus(result.kind ?? "runtime");
    } catch (error) {
      if (revision.current !== current || controller.signal.aborted) return;
      setStatus(mode === "local" ? "connection" : "runtime");
      setDiagnostics([{ level: "error", message: error instanceof Error ? error.message : String(error) }]);
    }
  }
  runLatest.current = () => { void run(); };
  useEffect(() => {
    if (auto && canRun && pendingChanges) debounce.current = setTimeout(() => runLatest.current(), 650);
    return () => clearTimeout(debounce.current);
  }, [source, theme, size, auto, canRun, pendingChanges, mode]);

  function reset() {
    invalidate(); setSource(selected.source); setTheme("light"); setSize("640x400");
    setCandidate(undefined); setGood(undefined); setPreviewRevision((value) => value + 1);
  }
  function cancel() { invalidate(); setStatus("cancelled"); }
  function selectPreset(value: string) {
    const example = examples.find((item) => item.id === value);
    if (!example) throw new Error(`Unknown application example: ${value}`);
    invalidate(); setPreset(example.id); setSource(example.source); setCandidate(undefined); setGood(undefined);
    setTheme("light"); setSize("640x400");
    if (syncUrl) { const url = new URL(window.location.href); url.searchParams.set("example", value); window.history.replaceState(null, "", url); }
  }
  function onResult(error?: PreviewError, running?: InteractiveArtifact) {
    setRuntimeError(error);
    if (error) {
      setStatus(error.kind);
      if (error.line) {
        setDiagnostics([{ level: "error", ...error }]);
        setRuntimeError(undefined);
      }
    } else if (running) {
      setDisplayed(running);
      if (candidate && running === artifact) {
        setGood({ ...candidate, result: { ...candidate.result, elapsedMs: Math.round(performance.now() - started.current) } });
        setStatus("success");
      }
    }
  }
  const labels: Record<string, string> = en ? {
    ready: "Ready", running: mode === "browser" ? "Running in browser…" : "Compiling Rust…", success: "Component updated", compile: "Rust compilation failed",
    mount: "View validation failed", runtime: "Component runtime failed", timeout: "Time limit exceeded", cancelled: "Cancelled",
    connection: "Connection error", toolchain: "Toolchain error", output: "Output limit exceeded", syntax: "Syntax error",
    unsupported: "Outside the browser subset", range: "Value out of range", limit: "Execution limit reached", type: "Value type mismatch", name: "Unknown name",
  } : {
    ready: "可交互 · 等待修改", running: mode === "browser" ? "正在浏览器中运行…" : "正在编译 Rust…", success: "组件已更新", compile: "Rust 编译失败",
    mount: "界面校验失败", runtime: "组件运行失败", timeout: "运行超时", cancelled: "已取消", connection: "连接失败", toolchain: "工具链错误",
    output: "输出超过限制", syntax: "语法错误", unsupported: "超出浏览器支持范围", range: "数值超出范围", limit: "超过运行限制", type: "值类型不匹配", name: "名称未定义",
  };
  return { preset, source, theme, size, mode, auto, canRun, connection, status, diagnostics, good, displayed,
    runtimeError, artifact, stale, focusLine, labels, cancelRevision, setFocusLine, setAuto, changeSource,
    changeTheme, changeSize, changeMode, reset, cancel, selectPreset, run, connect, onResult };
}
