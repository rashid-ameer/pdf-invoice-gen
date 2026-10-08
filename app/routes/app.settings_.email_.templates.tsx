/**
 * Email templates list — opens existing per-type editors.
 * No editable fields; no save bar.
 */
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";

type TemplateRow = {
  id: string;
  title: string;
  accessibilityLabel: string;
  href: string;
};

const TEMPLATE_ROWS: TemplateRow[] = [
  {
    id: "invoice",
    title: "Tax invoice email",
    accessibilityLabel: "Edit tax invoice email",
    href: "/app/settings/email/invoice",
  },
  {
    id: "credit-note",
    title: "Credit note email",
    accessibilityLabel: "Edit credit note email",
    href: "/app/settings/email/credit-note",
  },
  {
    id: "refund",
    title: "Refund document email",
    accessibilityLabel: "Edit refund document email",
    href: "/app/settings/email/refund",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function EmailTemplatesListPage() {
  return (
    <s-page heading="Email templates">
      <s-link slot="breadcrumb-actions" href="/app/settings">
        Settings
      </s-link>
      <s-link slot="breadcrumb-actions" href="/app/settings/email">
        Email
      </s-link>

      <s-section>
        <s-stack gap="base">
          <s-text color="subdued">
            Choose an email to edit its layout, wording, and colors.
          </s-text>
          <s-stack gap="none">
            {TEMPLATE_ROWS.map((row, index) => (
              <s-stack key={row.id} gap="none">
                <TemplateEmailRow row={row} />
                {index < TEMPLATE_ROWS.length - 1 ? <s-divider /> : null}
              </s-stack>
            ))}
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

function TemplateEmailRow({ row }: { row: TemplateRow }) {
  return (
    <s-clickable
      href={row.href}
      accessibilityLabel={row.accessibilityLabel}
      padding="base"
    >
      <s-grid
        gridTemplateColumns="1fr auto"
        gap="base"
        alignItems="center"
      >
        <s-text type="strong">{row.title}</s-text>
        <s-icon type="chevron-right" color="subdued" />
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
