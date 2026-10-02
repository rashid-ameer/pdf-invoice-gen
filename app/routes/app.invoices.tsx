import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";

/**
 * Placeholder for the Group 9 Invoices admin UI.
 * Backend/list/CSV/view/PDF/sync/webhook APIs remain available on sibling routes;
 * this page will be rebuilt separately.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function InvoicesPagePlaceholder() {
  return (
    <s-page heading="Invoices">
      <s-section>
        <s-paragraph>
          The Invoices UI is being rebuilt. Document list, export, view, and
          download APIs remain available.
        </s-paragraph>
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
