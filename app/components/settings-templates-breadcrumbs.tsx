/**
 * Single parent breadcrumb for template pages (Shopify App Home shows one link).
 */
export function SettingsTemplatesBreadcrumbs({
  parentHref = "/app/settings/templates",
  parentLabel = "Templates",
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
