/**
 * Breadcrumb overflow for template edit / change pages.
 * App Home only renders the first `breadcrumb-actions` link, so Settings +
 * Templates cannot both show as a trail. Use "…" that opens a menu instead.
 */
export function SettingsTemplatesBreadcrumbs({
  menuId,
  templatesHref = "/app/settings/templates",
}: {
  menuId: string;
  templatesHref?: string;
}) {
  return (
    <>
      <s-button
        slot="breadcrumb-actions"
        variant="tertiary"
        commandFor={menuId}
        accessibilityLabel="Navigate to Settings or Templates"
      >
        …
      </s-button>
      <s-menu id={menuId} accessibilityLabel="Parent pages">
        <s-button href="/app/settings">Settings</s-button>
        <s-button href={templatesHref}>Templates</s-button>
      </s-menu>
    </>
  );
}
