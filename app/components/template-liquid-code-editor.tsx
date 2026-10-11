/**
 * Old-app Liquid/HTML editor: transparent textarea over a syntax-highlight layer
 * + line gutter (`template-code-editor.js` / `template-editor.ts` code-shell).
 * Not CodeMirror / Monaco / Quill — same custom editor as the previous app.
 *
 * Shell height is fixed so long templates scroll inside the editor and do not
 * stretch the preview column / page layout.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

export type TemplateLiquidCodeEditorHandle = {
  insertToken: (token: string) => void;
  focus: () => void;
};

type Props = {
  value: string;
  onChange: (next: string) => void;
  syntaxLine?: number | null;
};

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Port of old `highlightLine` in template-code-editor.js */
function highlightLine(line: string): string {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line.startsWith("{{", i)) {
      const endOut = line.indexOf("}}", i + 2);
      const closeOut = endOut === -1 ? line.length : endOut + 2;
      out += `<span class="tok-liquid-out">${escapeHtml(line.slice(i, closeOut))}</span>`;
      i = closeOut;
      continue;
    }
    if (line.startsWith("{%", i)) {
      const endTag = line.indexOf("%}", i + 2);
      const closeTag = endTag === -1 ? line.length : endTag + 2;
      out += `<span class="tok-liquid-tag">${escapeHtml(line.slice(i, closeTag))}</span>`;
      i = closeTag;
      continue;
    }
    if (line.startsWith("<!--", i)) {
      const endCom = line.indexOf("-->", i + 4);
      const closeCom = endCom === -1 ? line.length : endCom + 3;
      out += `<span class="tok-comment">${escapeHtml(line.slice(i, closeCom))}</span>`;
      i = closeCom;
      continue;
    }
    if (line[i] === "<") {
      const gt = line.indexOf(">", i + 1);
      const closeHtml = gt === -1 ? line.length : gt + 1;
      const raw = line.slice(i, closeHtml);
      const html = escapeHtml(raw).replace(
        /(\s)([a-zA-Z_:][-a-zA-Z0-9_:]*)(=)/g,
        '$1<span class="tok-attr">$2</span>$3',
      );
      out += `<span class="tok-tag">${html}</span>`;
      i = closeHtml;
      continue;
    }
    let next = line.length;
    const a = line.indexOf("<", i);
    const b = line.indexOf("{", i);
    if (a !== -1) next = Math.min(next, a);
    if (b !== -1) next = Math.min(next, b);
    if (next === i) {
      out += escapeHtml(line[i]!);
      i += 1;
      continue;
    }
    out += escapeHtml(line.slice(i, next));
    i = next;
  }
  return out || " ";
}

export const TemplateLiquidCodeEditor = forwardRef<
  TemplateLiquidCodeEditorHandle,
  Props
>(function TemplateLiquidCodeEditor(
  { value, onChange, syntaxLine = null },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  const lines = useMemo(() => value.split("\n"), [value]);

  useImperativeHandle(ref, () => ({
    insertToken(token: string) {
      const el = textareaRef.current;
      if (!el) {
        onChange(value + token);
        return;
      }
      const start = el.selectionStart ?? value.length;
      const end = el.selectionEnd ?? start;
      const next = value.slice(0, start) + token + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    },
    focus() {
      textareaRef.current?.focus();
    },
  }));

  /** Grow textarea to content so the highlight layer stays aligned; shell scrolls. */
  const autosize = () => {
    const textarea = textareaRef.current;
    const scroll = scrollRef.current;
    if (!textarea || !scroll) return;
    textarea.style.height = "0px";
    const next = Math.max(textarea.scrollHeight, scroll.clientHeight);
    textarea.style.height = `${next}px`;
  };

  const syncScroll = () => {
    const scroll = scrollRef.current;
    const gutter = gutterRef.current;
    if (!scroll || !gutter) return;
    gutter.scrollTop = scroll.scrollTop;
  };

  useEffect(() => {
    autosize();
    syncScroll();
  }, [value, lines.length]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const onScroll = () => syncScroll();
    scroll.addEventListener("scroll", onScroll);
    return () => scroll.removeEventListener("scroll", onScroll);
  }, []);

  const highlightHtml = lines
    .map((line, idx) => {
      const n = idx + 1;
      const cls = n === syntaxLine ? "code-line is-error" : "code-line";
      return `<div class="${cls}">${highlightLine(line)}</div>`;
    })
    .join("");

  return (
    <>
      <style>{CODE_EDITOR_CSS}</style>
      <div className="tpl-code-shell">
        <div className="tpl-code-gutter" ref={gutterRef} aria-hidden="true">
          {lines.map((_, idx) => {
            const n = idx + 1;
            const cls =
              n === syntaxLine ? "gutter-line is-error" : "gutter-line";
            return (
              <div key={n} className={cls}>
                {n}
              </div>
            );
          })}
        </div>
        <div className="tpl-code-scroll" ref={scrollRef}>
          <div className="tpl-code-layer">
            <pre
              className="tpl-code-highlight"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: highlightHtml }}
            />
            <textarea
              ref={textareaRef}
              className="tpl-code-input"
              value={value}
              spellCheck={false}
              wrap="off"
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              aria-label="HTML / Liquid"
              onChange={(event) => onChange(event.currentTarget.value)}
              onInput={autosize}
            />
          </div>
        </div>
      </div>
    </>
  );
});

const CODE_EDITOR_CSS = `
.tpl-code-shell {
  display: grid;
  grid-template-columns: 48px 1fr;
  border: 1px solid #c9cccf;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
  /* Fixed shell — long Liquid scrolls inside; does not stretch preview column. */
  height: min(560px, 70vh);
  min-height: 360px;
  box-sizing: border-box;
}
.tpl-code-gutter {
  background: #f6f6f7;
  color: #8c9196;
  text-align: right;
  padding: 12px 8px;
  font: 13px/20px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  user-select: none;
  overflow: hidden;
  height: 100%;
  box-sizing: border-box;
}
.tpl-code-gutter .gutter-line { height: 20px; }
.tpl-code-gutter .gutter-line.is-error {
  background: #d8eafc;
  color: #202223;
  margin: 0 -8px;
  padding: 0 8px;
}
.tpl-code-scroll {
  position: relative;
  overflow: auto;
  background: #fff;
  height: 100%;
  min-height: 0;
}
.tpl-code-layer { position: relative; min-height: 100%; }
.tpl-code-highlight, .tpl-code-input {
  margin: 0;
  padding: 12px 14px;
  border: 0;
  font: 13px/20px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre;
  word-wrap: normal;
  tab-size: 2;
  box-sizing: border-box;
}
.tpl-code-highlight {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  pointer-events: none;
  color: #202223;
}
.tpl-code-highlight .code-line { min-height: 20px; }
.tpl-code-highlight .code-line.is-error { background: #d8eafc; }
.tpl-code-input {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  min-height: 100%;
  background: transparent;
  color: transparent;
  caret-color: #202223;
  resize: none;
  outline: none;
  overflow: hidden;
}
.tpl-code-shell .tok-tag { color: #0b7a75; }
.tpl-code-shell .tok-attr { color: #9c6b08; }
.tpl-code-shell .tok-liquid-tag { color: #7c3aed; }
.tpl-code-shell .tok-liquid-out { color: #c05717; }
.tpl-code-shell .tok-comment { color: #8c9196; }
`;
