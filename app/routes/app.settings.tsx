/**
 * Settings hub — lists settings areas.
 */
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  SettingsNavRow,
  type SettingsNavItem,
} from "../components/settings-nav-row";
import { authenticate } from "../shopify.server";

const SETTINGS_AREAS: SettingsNavItem[] = [
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
                  <SettingsNavRow item={area} />
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

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
