import type {LoaderFunctionArgs} from 'react-router';
import {Link} from 'react-router';

import {requireExtraFeatureFlag} from '../models/shop-extra-features.server';
import {authenticate} from '../shopify.server';

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  await requireExtraFeatureFlag(session.shop, 'upsellEnabled');
  return null;
};

export default function UpsellLandingPage() {
  return (
    <s-page heading="Upsell">
      <s-section heading="Product Recommendation">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            Set up and customize product recommendation upsells.
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <Link to="/app/upsell/customize">
              <s-button variant="primary">Customize</s-button>
            </Link>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}
