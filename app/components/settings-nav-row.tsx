/**
 * Shared Settings-style navigation row (title + description + chevron).
 * Used by the Settings hub and the Email hub.
 */
export type SettingsNavItem = {
  id: string;
  title: string;
  description: string;
  href?: string;
  status?: "incomplete";
};

export function SettingsNavRow({ item }: { item: SettingsNavItem }) {
  const accessibilityLabel = `${item.title}: ${item.description}`;
  const clickableProps = item.href
    ? { href: item.href, accessibilityLabel }
    : { accessibilityLabel };

  return (
    <s-clickable padding="base" {...clickableProps}>
      <s-grid
        gridTemplateColumns="1fr auto"
        gap="base"
        alignItems="center"
      >
        <s-stack gap="none">
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <s-heading>{item.title}</s-heading>
            {item.status === "incomplete" ? (
              <s-badge tone="warning">Incomplete</s-badge>
            ) : null}
          </s-stack>
          <s-text color="subdued">{item.description}</s-text>
        </s-stack>
        <s-icon type="chevron-right" />
      </s-grid>
    </s-clickable>
  );
}
