/**
 * Single parent breadcrumb for Email settings subpages (Shopify App Home shows one link).
 */
export function SettingsEmailBreadcrumbs({
  parentHref = "/app/settings/email",
  parentLabel = "Email",
}: {
  parentHref?: string;
  parentLabel?: string;
}) {
  return (
    <s-link slot="breadcrumb-actions" href={parentHref}>
      {parentLabel}
    </s-link>
  );
}
