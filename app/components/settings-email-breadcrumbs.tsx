/**
 * Breadcrumb overflow for Email settings subpages.
 * App Home only renders the first `breadcrumb-actions` link, so Settings +
 * Email cannot both show as a trail. Use "…" that opens a menu instead.
 */
export function SettingsEmailBreadcrumbs({
  menuId,
  emailHref = "/app/settings/email",
}: {
  menuId: string;
  emailHref?: string;
}) {
  return (
    <>
      <s-button
        slot="breadcrumb-actions"
        variant="tertiary"
        commandFor={menuId}
        accessibilityLabel="Navigate to Settings or Email"
      >
        …
      </s-button>
      <s-menu id={menuId} accessibilityLabel="Parent pages">
        <s-button href="/app/settings">Settings</s-button>
        <s-button href={emailHref}>Email</s-button>
      </s-menu>
    </>
  );
}
