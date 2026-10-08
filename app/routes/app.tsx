import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { SHOW_COMPLIANCE_PAGE } from "../constants/app";
import { authenticate } from "../shopify.server";
import { isNetworkFetchError } from "../utils/network-error";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <s-app-nav>
        {/* rel="home" is valid on s-app-nav children; Polaris JSX types omit it. */}
        <s-link href="/app" {...({ rel: "home" } as Record<string, string>)}>
          Home
        </s-link>
        <s-link href="/app/invoices">Invoices</s-link>
        <s-link href="/app/packing-slips">Packing slips</s-link>
        <s-link href="/app/credit-notes">Credit notes</s-link>
        {SHOW_COMPLIANCE_PAGE ? (
          <s-link href="/app/compliance">Compliance</s-link>
        ) : null}
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/help">Help &amp; Support</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();

  if (isNetworkFetchError(error)) {
    return (
      <s-page heading="Connection problem">
        <s-banner tone="critical" heading="Couldn't connect">
          Check your connection and try again.
        </s-banner>
        <s-button
          variant="primary"
          onClick={() => {
            window.location.reload();
          }}
        >
          Try again
        </s-button>
      </s-page>
    );
  }

  return boundary.error(error);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
