/**
 * Settings hub — lists settings areas. No forms; rows do not navigate yet.
 * Set `href` on a row's s-clickable when that destination is ready.
 */
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";

type SettingsArea = {
  id: string;
  title: string;
  description: string;
  /** Set later to enable navigation (e.g. "/app/settings/company"). */
  href?: string;
  status?: "incomplete";
};

const SETTINGS_AREAS: SettingsArea[] = [
  {
    id: "company",
    title: "Company",
    description:
      "Business name, address, tax details, and contact information.",
    href: "/app/settings/company",
  },
  {
    id: "branding",
    title: "Branding",
    description:
      "Logo, colors, and fonts used across your documents and emails.",
    href: "/app/settings/branding",
  },
  {
    id: "templates",
    title: "Templates",
    description: "Choose and edit the template for each document type.",
    href: "/app/settings/templates",
  },
  {
    id: "email",
    title: "Email",
    description: "Automatic emails, sender name, and reply-to address.",
    href: "/app/settings/email",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function SettingsPage() {
  return (
    <s-page heading="Settings">
      <s-section>
        <s-stack gap="base">
          <s-text color="subdued">Choose a settings area.</s-text>
          <s-box border="base" borderRadius="base" overflow="hidden">
            <s-stack gap="none">
              {SETTINGS_AREAS.map((area, index) => (
                <s-stack key={area.id} gap="none">
                  <SettingsAreaRow area={area} />
                  {index < SETTINGS_AREAS.length - 1 ? <s-divider /> : null}
                </s-stack>
              ))}
            </s-stack>
          </s-box>
        </s-stack>
      </s-section>
    </s-page>
  );
}

function SettingsAreaRow({ area }: { area: SettingsArea }) {
  const accessibilityLabel = `${area.title}: ${area.description}`;
  const clickableProps = area.href
    ? { href: area.href, accessibilityLabel }
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
            <s-heading>{area.title}</s-heading>
            {area.status === "incomplete" ? (
              <s-badge tone="warning">Incomplete</s-badge>
            ) : null}
          </s-stack>
          <s-text color="subdued">{area.description}</s-text>
        </s-stack>
        <s-icon type="chevron-right" />
      </s-grid>
    </s-clickable>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
