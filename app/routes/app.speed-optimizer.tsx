import {useEffect, useState} from 'react';
import type {ActionFunctionArgs, LoaderFunctionArgs} from 'react-router';
import {
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from 'react-router';
import {SaveBar, useAppBridge} from '@shopify/app-bridge-react';

import {checkedValue, fieldValue, numberValue} from '../utils/polaris-events';
import {requireExtraFeatureFlag} from '../models/shop-extra-features.server';
import {
  getSpeedOptimizerSettings,
  saveSpeedOptimizerSettings,
  type SpeedOptimizerSettings,
} from '../models/speed-optimizer-settings.server';
import {authenticate} from '../shopify.server';

const SAVE_BAR_ID = 'speed-optimizer-save-bar';

export const loader = async ({request}: LoaderFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  await requireExtraFeatureFlag(session.shop, 'speedOptimizerEnabled');
  return {settings: await getSpeedOptimizerSettings(session.shop)};
};

export const action = async ({request}: ActionFunctionArgs) => {
  const {session} = await authenticate.admin(request);
  await requireExtraFeatureFlag(session.shop, 'speedOptimizerEnabled');
  const formData = await request.formData();
  await saveSpeedOptimizerSettings(session.shop, {
    enabled: formData.get('enabled') === 'true',
    excludedPages: String(formData.get('excludedPages') || ''),
    prefetchLimit: Number(formData.get('prefetchLimit') || 10),
  });
  return {ok: true};
};

export default function SpeedOptimizerPage() {
  const {settings: saved} = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const [settings, setSettings] = useState<SpeedOptimizerSettings>(saved);
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);
  const saving =
    navigation.state === 'submitting' && navigation.formMethod === 'POST';

  useEffect(() => setSettings(saved), [saved]);
  useEffect(() => {
    if (actionData && 'ok' in actionData && actionData.ok) {
      shopify.toast.show('Speed optimizer saved');
    }
  }, [actionData, shopify]);

  useEffect(() => {
    const btn = document.querySelector(
      `#${SAVE_BAR_ID} [variant="primary"]`,
    ) as HTMLButtonElement | null;
    if (!btn) return;
    if (saving) btn.setAttribute('loading', 'true');
    else btn.removeAttribute('loading');
  }, [saving]);

  useEffect(() => {
    return () => {
      try {
        shopify.saveBar.hide(SAVE_BAR_ID);
      } catch {
        /* ignore */
      }
    };
  }, [shopify]);

  const onSave = () => {
    const fd = new FormData();
    fd.set('enabled', settings.enabled ? 'true' : 'false');
    fd.set('excludedPages', settings.excludedPages);
    fd.set('prefetchLimit', String(settings.prefetchLimit));
    submit(fd, {method: 'post'});
  };

  return (
    <s-page heading="Speed Optimizer">
      <SaveBar id={SAVE_BAR_ID} open={dirty}>
        <button type="button" variant="primary" onClick={onSave} disabled={saving}>
          Save
        </button>
        <button
          type="button"
          onClick={() => setSettings(saved)}
          disabled={saving}
        >
          Discard
        </button>
      </SaveBar>

      <s-banner tone="info">
        When enabled, pages are silently loaded in the background when a visitor
        hovers over a link. This makes navigation feel instant without any
        visible change to your storefront.
      </s-banner>

      <s-section heading="Settings">
        <s-stack gap="base">
          <s-checkbox
            label="Enable Speed Optimizer"
            details="Activate prefetching for all visitors on your storefront."
            checked={settings.enabled}
            onChange={(e: Event) =>
              setSettings((s) => ({...s, enabled: checkedValue(e)}))
            }
          />

          <s-divider />

          <s-text-field
            label="Excluded Pages"
            details="Comma-separated paths that should NOT be prefetched (e.g. /cart,/checkout,/account)."
            value={settings.excludedPages}
            autocomplete="off"
            onInput={(e: Event) =>
              setSettings((s) => ({
                ...s,
                excludedPages: fieldValue(e),
              }))
            }
          />

          <s-number-field
            label="Prefetch Limit"
            details="Maximum number of pages to prefetch per page visit. Keeps server load in check."
            value={String(settings.prefetchLimit)}
            min={1}
            max={50}
            step={1}
            inputMode="numeric"
            autocomplete="off"
            onInput={(e: Event) =>
              setSettings((s) => ({
                ...s,
                prefetchLimit: Number(numberValue(e)) || 10,
              }))
            }
          />
        </s-stack>
      </s-section>

      <s-section heading="How It Works">
        <s-stack gap="base">
          <s-ordered-list>
            <s-list-item>
              Visitor hovers over any link on your storefront
            </s-list-item>
            <s-list-item>
              The target page is fetched silently in the background
            </s-list-item>
            <s-list-item>Browser caches the response automatically</s-list-item>
            <s-list-item>
              When the visitor clicks, the page loads from cache — instantly
            </s-list-item>
          </s-ordered-list>
          <s-paragraph color="subdued">
            Excluded pages (like /cart and /checkout) are never prefetched to
            avoid unintended side effects on session-sensitive pages.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}
