import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type QuillType from "quill";

/**
 * Designed email body editor — Quill 2.0.2 snow toolbar matching the old
 * Delivery page (`delivery-email-editor.js`). Stores HTML via root.innerHTML;
 * Phase 1 `normalizeEmailBodyContent` / `sanitizeEmailBodyHtml` sanitize on save/send.
 *
 * Quill is loaded only in the browser (dynamic import) so SSR never touches `document`.
 * Not used for Custom HTML mode (raw textarea, same as old app).
 */

const TOOLBAR = [
  ["bold", "italic", "underline"],
  ["link"],
  [{ list: "ordered" }, { list: "bullet" }],
  [{ align: [] }],
] as const;

export type EmailBodyRichTextEditorHandle = {
  insertPlaceholder: (token: string) => void;
};

type Props = {
  label: string;
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  details?: string;
  placeholder?: string;
};

export const EmailBodyRichTextEditor = forwardRef<
  EmailBodyRichTextEditorHandle,
  Props
>(function EmailBodyRichTextEditor(
  {
    label,
    value,
    onChange,
    disabled = false,
    details,
    placeholder = "Write your message…",
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<QuillType | null>(null);
  const onChangeRef = useRef(onChange);
  const lastHtmlRef = useRef(value);
  const valueRef = useRef(value);
  const disabledRef = useRef(disabled);
  const skipNextExternalSync = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let quill: QuillType | null = null;
    let onTextChange: (() => void) | null = null;

    void (async () => {
      const [{ default: Quill }] = await Promise.all([
        import("quill"),
        import("quill/dist/quill.snow.css"),
      ]);
      if (cancelled || !hostRef.current) return;

      const mount = document.createElement("div");
      hostRef.current.appendChild(mount);

      quill = new Quill(mount, {
        theme: "snow",
        modules: {
          toolbar: TOOLBAR,
        },
        placeholder,
      });

      const initial = valueRef.current || "";
      if (initial) {
        quill.clipboard.dangerouslyPasteHTML(initial);
      }
      lastHtmlRef.current = quill.root.innerHTML;

      onTextChange = () => {
        if (!quill) return;
        const html = quill.root.innerHTML;
        if (html === lastHtmlRef.current) return;
        lastHtmlRef.current = html;
        skipNextExternalSync.current = true;
        onChangeRef.current(html);
      };

      quill.on("text-change", onTextChange);
      quill.enable(!disabledRef.current);
      quillRef.current = quill;
    })();

    return () => {
      cancelled = true;
      if (quill && onTextChange) {
        quill.off("text-change", onTextChange);
      }
      quillRef.current = null;
      host.replaceChildren();
    };
    // Mount once; value/disabled synced in separate effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;
    quill.enable(!disabled);
  }, [disabled]);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;
    if (skipNextExternalSync.current) {
      skipNextExternalSync.current = false;
      return;
    }
    if (value === lastHtmlRef.current) return;
    const selection = quill.getSelection();
    quill.clipboard.dangerouslyPasteHTML(value || "");
    lastHtmlRef.current = quill.root.innerHTML;
    if (selection) {
      try {
        quill.setSelection(selection);
      } catch {
        /* ignore out-of-range after paste */
      }
    }
  }, [value]);

  useImperativeHandle(ref, () => ({
    insertPlaceholder(token: string) {
      const quill = quillRef.current;
      if (!quill || disabled || !token) return;
      const range = quill.getSelection(true);
      const index = range ? range.index : Math.max(quill.getLength() - 1, 0);
      quill.insertText(index, token);
      quill.setSelection(index + token.length, 0);
      const html = quill.root.innerHTML;
      lastHtmlRef.current = html;
      skipNextExternalSync.current = true;
      onChangeRef.current(html);
    },
  }));

  return (
    <s-stack gap="small-100">
      <s-text type="strong">{label}</s-text>
      <s-box
        border="base"
        borderRadius="base"
        overflow="hidden"
        background="base"
      >
        <div
          ref={hostRef}
          data-email-body-editor=""
          aria-label={label}
          aria-disabled={disabled || undefined}
        />
      </s-box>
      {details ? <s-paragraph color="subdued">{details}</s-paragraph> : null}
    </s-stack>
  );
});
