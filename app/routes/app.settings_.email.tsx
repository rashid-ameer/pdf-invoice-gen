/**
 * Email hub — lists email setting areas (same row pattern as Settings hub).
 * Subpages: automated-emails, sender-recipients, templates.
 * Per-type editors remain at /app/settings/email/:type.
 */
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { EmailSandboxBanner } from "../components/email-sandbox-banner";
import {
  SettingsNavRow,
  type SettingsNavItem,
} from "../components/settings-nav-row";
import { isEmailProviderConfigured } from "../models/document-email.server";
import { authenticate } from "../shopify.server";

const EMAIL_AREAS: SettingsNavItem[] = [
  {
    id: "automated-emails",
    title: "Automated emails",
    description: "Choose which documents are emailed automatically.",
    href: "/app/settings/email/automated-emails",
  },
  {
    id: "sender-recipients",
    title: "Sender and recipients",
    description: "Who your emails come from and who receives them.",
    href: "/app/settings/email/sender-recipients",
  },
  {
    id: "templates",
    title: "Email templates",
    description: "Edit the layout, wording, and colors of each email.",
    href: "/app/settings/email/templates",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const emailFrom = process.env.EMAIL_FROM ?? "";
  return {
    emailFrom,
    emailConfigured: isEmailProviderConfigured(),
  };
};

export default function EmailHubPage() {
  const { emailFrom } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Email">
      <s-link slot="breadcrumb-actions" href="/app/settings">
        Settings
      </s-link>

      <EmailSandboxBanner emailFrom={emailFrom} />

      <s-section>
        <s-stack gap="base">
          <s-text color="subdued">Choose an email setting.</s-text>
          <s-box border="base" borderRadius="base" overflow="hidden">
            <s-stack gap="none">
              {EMAIL_AREAS.map((area, index) => (
                <s-stack key={area.id} gap="none">
                  <SettingsNavRow item={area} />
                  {index < EMAIL_AREAS.length - 1 ? <s-divider /> : null}
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
