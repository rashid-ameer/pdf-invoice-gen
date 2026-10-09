/**
 * Initial installation onboarding gate.
 *
 * Locked only when Setting `initial_setup_required` is true and
 * `initial_setup_completed` is not true. New Stores get the required flag in
 * handleAppInstall; existing Stores without it are grandfathered.
 */
import type { Prisma } from "@prisma/client";

import prisma from "../db.server";
import type { DocumentType } from "../types/index";
import {
  INITIAL_SETUP_COMPLETED_KEY,
  INITIAL_SETUP_DISMISSED_KEY,
  INITIAL_SETUP_REQUIRED_KEY,
  INITIAL_SETUP_TEMPLATE_ORDER,
} from "./initial-setup";

export {
  INITIAL_SETUP_COMPLETED_KEY,
  INITIAL_SETUP_DISMISSED_KEY,
  INITIAL_SETUP_REQUIRED_KEY,
  INITIAL_SETUP_TEMPLATE_ORDER,
  initialSetupTemplateHref,
  isInitialSetupPathAllowed,
  isInitialSetupQuery,
} from "./initial-setup";

export type InitialSetupState = {
  /** True when this store was flagged at new install. */
  required: boolean;
  /** True after merchant clicks Finish setup. */
  completed: boolean;
  /** True after merchant dismisses Setup on Home (post-Finish). */
  dismissed: boolean;
  /** required && !completed — app is locked to onboarding. */
  locked: boolean;
  /** required && !dismissed — show Setup on Home (locked or post-Finish). */
  showOnHome: boolean;
  companyComplete: boolean;
  templatesComplete: boolean;
  /** True when both stages are done (Finish may still be pending). */
  stagesComplete: boolean;
  /** First missing template type, or null when all four defaults are set. */
  nextTemplateType: DocumentType | null;
  templateDefaults: {
    tax_invoice: boolean;
    packing_slip: boolean;
    credit_note: boolean;
    refund_document: boolean;
  };
};

type AddressJson = {
  line1?: string;
  line2?: string;
  city?: string;
  emirate?: string;
  postalCode?: string;
  country?: string;
};

function asAddress(value: Prisma.JsonValue | null | undefined): AddressJson {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as AddressJson;
}

function settingIsTrue(value: Prisma.JsonValue | null | undefined): boolean {
  return value === true || value === "true";
}

/**
 * Same required fields as saveCompanySetup (onboarding.server.ts).
 * Does not invent extra rules.
 */
export function isCompanySetupDataComplete(input: {
  legalName: string | null | undefined;
  businessEmail: string | null | undefined;
  businessPhone: string | null | undefined;
  vatStatus: string | null | undefined;
  trn: string | null | undefined;
  address: Prisma.JsonValue | null | undefined;
}): boolean {
  const legalName = (input.legalName ?? "").trim();
  const businessEmail = (input.businessEmail ?? "").trim();
  const businessPhone = (input.businessPhone ?? "").trim();
  const address = asAddress(input.address);
  const addressLine1 = (address.line1 ?? "").trim();
  const city = (address.city ?? "").trim();
  const country = (address.country ?? "").trim();
  const trn = (input.trn ?? "").trim();
  const vatStatus =
    input.vatStatus === "not_registered" ||
    (!trn && input.vatStatus !== "registered")
      ? "not_registered"
      : "registered";

  if (!legalName || !businessEmail || !addressLine1 || !city || !country) {
    return false;
  }
  if (!businessPhone) return false;
  if (vatStatus === "registered" && !trn) return false;
  return true;
}

function defaultIdForType(
  store: {
    defaultTemplateId: string | null;
    defaultPackingSlipTemplateId: string | null;
    defaultCreditNoteTemplateId: string | null;
    defaultRefundDocumentTemplateId: string | null;
  },
  documentType: DocumentType,
): string | null {
  if (documentType === "packing_slip") {
    return store.defaultPackingSlipTemplateId;
  }
  if (documentType === "credit_note") {
    return store.defaultCreditNoteTemplateId;
  }
  if (documentType === "refund_document") {
    return store.defaultRefundDocumentTemplateId;
  }
  return store.defaultTemplateId;
}

export function nextMissingTemplateType(store: {
  defaultTemplateId: string | null;
  defaultPackingSlipTemplateId: string | null;
  defaultCreditNoteTemplateId: string | null;
  defaultRefundDocumentTemplateId: string | null;
}): DocumentType | null {
  for (const type of INITIAL_SETUP_TEMPLATE_ORDER) {
    if (!defaultIdForType(store, type)) return type;
  }
  return null;
}

async function readStoreSettings(
  storeId: string,
  merchantId: string,
): Promise<{ required: boolean; completed: boolean; dismissed: boolean }> {
  const rows = await prisma.setting.findMany({
    where: {
      storeId,
      merchantId,
      key: {
        in: [
          INITIAL_SETUP_REQUIRED_KEY,
          INITIAL_SETUP_COMPLETED_KEY,
          INITIAL_SETUP_DISMISSED_KEY,
        ],
      },
    },
  });
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    required: settingIsTrue(map[INITIAL_SETUP_REQUIRED_KEY]),
    completed: settingIsTrue(map[INITIAL_SETUP_COMPLETED_KEY]),
    dismissed: settingIsTrue(map[INITIAL_SETUP_DISMISSED_KEY]),
  };
}

async function upsertStoreSetting(
  store: { id: string; merchantId: string },
  key: string,
  value: boolean,
): Promise<void> {
  await prisma.setting.upsert({
    where: {
      merchantId_storeId_key: {
        merchantId: store.merchantId,
        storeId: store.id,
        key,
      },
    },
    create: {
      merchantId: store.merchantId,
      storeId: store.id,
      scope: "store",
      key,
      value,
    },
    update: {
      value,
    },
  });
}

/**
 * Write initial_setup_required for a newly created Store only.
 * Call from handleAppInstall create branch — never on update/reinstall.
 */
export async function markInitialSetupRequired(store: {
  id: string;
  merchantId: string;
}): Promise<void> {
  await upsertStoreSetting(store, INITIAL_SETUP_REQUIRED_KEY, true);
}

export async function getInitialSetupState(
  shopDomain: string,
): Promise<InitialSetupState | null> {
  const store = await prisma.store.findUnique({
    where: { shopifyDomain: shopDomain },
  });
  if (!store) return null;

  const flags = await readStoreSettings(store.id, store.merchantId);
  const locked = flags.required && !flags.completed;
  const showOnHome = flags.required && !flags.dismissed;

  const legalEntity = store.defaultLegalEntityId
    ? await prisma.legalEntity.findUnique({
        where: { id: store.defaultLegalEntityId },
      })
    : null;

  const companyComplete = legalEntity
    ? isCompanySetupDataComplete(legalEntity)
    : false;

  const templateDefaults = {
    tax_invoice: Boolean(store.defaultTemplateId),
    packing_slip: Boolean(store.defaultPackingSlipTemplateId),
    credit_note: Boolean(store.defaultCreditNoteTemplateId),
    refund_document: Boolean(store.defaultRefundDocumentTemplateId),
  };
  const nextTemplateType = nextMissingTemplateType(store);
  const templatesComplete = nextTemplateType === null;
  const stagesComplete = companyComplete && templatesComplete;

  return {
    required: flags.required,
    completed: flags.completed,
    dismissed: flags.dismissed,
    locked,
    showOnHome,
    companyComplete,
    templatesComplete,
    stagesComplete,
    nextTemplateType,
    templateDefaults,
  };
}

export async function finishInitialSetup(
  shopDomain: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const store = await prisma.store.findUnique({
    where: { shopifyDomain: shopDomain },
  });
  if (!store) {
    return { ok: false, error: "Store not found" };
  }

  const state = await getInitialSetupState(shopDomain);
  if (!state) {
    return { ok: false, error: "Store not found" };
  }
  if (!state.locked) {
    return { ok: false, error: "Initial setup is not active for this store." };
  }
  if (!state.stagesComplete) {
    return {
      ok: false,
      error: "Complete company setup and all default templates first.",
    };
  }

  await upsertStoreSetting(store, INITIAL_SETUP_COMPLETED_KEY, true);
  return { ok: true };
}

/**
 * Permanently hide Setup on Home after Finish. Does not change locked/completed.
 */
export async function dismissInitialSetup(
  shopDomain: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const store = await prisma.store.findUnique({
    where: { shopifyDomain: shopDomain },
  });
  if (!store) {
    return { ok: false, error: "Store not found" };
  }

  const state = await getInitialSetupState(shopDomain);
  if (!state) {
    return { ok: false, error: "Store not found" };
  }
  if (!state.required) {
    return { ok: false, error: "Initial setup is not active for this store." };
  }
  if (!state.completed) {
    return {
      ok: false,
      error: "Finish setup before dismissing.",
    };
  }
  if (state.dismissed) {
    return { ok: false, error: "Setup is already dismissed." };
  }

  await upsertStoreSetting(store, INITIAL_SETUP_DISMISSED_KEY, true);
  return { ok: true };
}
