import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { rust } from "@codemirror/lang-rust";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";

export type RustDiagnostic = {
  level: string;
  message: string;
  code?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  notes?: string[];
};

export function RustEditor({
  value,
  onChange,
  onRun,
  diagnostics,
  focusLine,
}: {
  value: string;
  onChange: (value: string) => void;
  onRun: () => void;
  diagnostics: RustDiagnostic[];
  focusLine?: { line: number; timestamp: number };
}) {
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onRun });
  callbacks.current = { onChange, onRun };
  const initial = useRef(value);

  useEffect(() => {
    if (!container.current) return;
    const view = new EditorView({
      parent: container.current,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          basicSetup,
          rust(),
          syntaxHighlighting(
            HighlightStyle.define([
              { tag: tags.keyword, color: "var(--editor-keyword)" },
              {
                tag: [tags.string, tags.character],
                color: "var(--editor-string)",
              },
              { tag: [tags.number, tags.bool], color: "var(--editor-number)" },
              {
                tag: [tags.typeName, tags.namespace],
                color: "var(--editor-type)",
              },
              {
                tag: tags.function(tags.variableName),
                color: "var(--editor-function)",
              },
              {
                tag: tags.comment,
                color: "var(--rp-c-text-2)",
                fontStyle: "italic",
              },
            ]),
          ),
          EditorView.contentAttributes.of({
            "aria-label": "Rust source",
            "data-testid": "rust-editor",
          }),
          keymap.of([
            {
              key: "Mod-Enter",
              run: () => {
                callbacks.current.onRun();
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              callbacks.current.onChange(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              backgroundColor: "transparent",
              color: "var(--rp-c-text-1)",
            },
            ".cm-scroller": {
              fontFamily: "var(--rp-font-family-mono)",
              fontSize: "13px",
              lineHeight: "1.75",
            },
            ".cm-content": {
              padding: "18px 0",
              caretColor: "var(--rp-c-brand)",
            },
            ".cm-cursor": { borderLeftColor: "var(--rp-c-text-1)" },
            ".cm-gutters": {
              backgroundColor: "transparent",
              border: "none",
              color: "var(--rp-c-text-3)",
            },
            ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px" },
            ".cm-activeLine, .cm-activeLineGutter": {
              backgroundColor: "var(--rp-c-bg-soft)",
            },
            "&.cm-focused": { outline: "none" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
              backgroundColor: "var(--rp-c-brand-tint)",
            },
            ".cm-tooltip": {
              backgroundColor: "var(--rp-c-bg)",
              color: "var(--rp-c-text-1)",
              borderColor: "var(--rp-c-divider)",
            },
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      view.destroy();
      editor.current = null;
    };
  }, []);

  useEffect(() => {
    const view = editor.current;
    if (view && value !== view.state.doc.toString())
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
  }, [value]);

  useEffect(() => {
    const view = editor.current;
    if (!view) return;
    function offset(line: number, column: number) {
      const text = view!.state.doc.line(
        Math.max(1, Math.min(line, view!.state.doc.lines)),
      );
      return (
        text.from +
        [...text.text].slice(0, Math.max(0, column - 1)).join("").length
      );
    }
    const markers: Diagnostic[] = diagnostics
      .filter((item) => item.line)
      .map((item) => ({
        from: offset(item.line!, item.column ?? 1),
        to: offset(
          item.endLine ?? item.line!,
          item.endColumn ?? (item.column ?? 1) + 1,
        ),
        severity: item.level === "warning" ? "warning" : "error",
        message: item.message,
      }));
    view.dispatch(setDiagnostics(view.state, markers));
  }, [diagnostics]);

  useEffect(() => {
    const view = editor.current;
    if (view && focusLine) {
      const line = view.state.doc.line(
        Math.max(1, Math.min(focusLine.line, view.state.doc.lines)),
      );
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      });
      view.focus();
    }
  }, [focusLine]);

  return <div className="rust-editor" ref={container} />;
}
