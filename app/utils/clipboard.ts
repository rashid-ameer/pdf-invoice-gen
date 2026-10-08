/**
 * Copy text to the clipboard. Prefers the Clipboard API, then falls back to a
 * hidden textarea + execCommand so copy still works after async work (e.g.
 * fetcher round-trips) when transient user activation is gone.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = String(text ?? "");
  if (!value) return false;

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Clipboard API often rejects after async work in the embedded admin.
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
