import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

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
        <s-link href="/app">Home</s-link>
        <s-link href="/app/invoices">Invoices</s-link>
        <s-link href="/app/packing-slips">Packing slips</s-link>
        <s-link href="/app/branding">Branding</s-link>
        <s-link href="/app/settings">Company setup</s-link>
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
