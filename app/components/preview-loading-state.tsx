/**
 * Section-level preview loading indicator.
 *
 * Shopify App Home guidance: use `s-spinner` with an accessibilityLabel for
 * in-page/section loading (not `shopify.loading`, which is for route-level work).
 * Keep the spinner where the preview will appear, with a short status label.
 */
type PreviewLoadingStateProps = {
  /** Announced to assistive tech and shown as subdued status text. */
  label?: string;
  /** Prefer `large` only for full-width overview/gallery previews. */
  size?: "base" | "large" | "small";
};

export function PreviewLoadingState({
  label = "Loading preview…",
  size,
}: PreviewLoadingStateProps) {
  return (
    <s-stack gap="small" alignItems="center" padding="large">
      <s-spinner
        accessibilityLabel={label}
        {...(size ? { size } : {})}
      />
      <s-text color="subdued">{label}</s-text>
    </s-stack>
  );
}
