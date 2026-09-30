import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import {
  parseSocialLinksFromForm,
  type StoreSocialLinksInput,
} from "./social-links.server";
import {
  getSocialLinksForShop,
  saveSocialLinksForShop,
} from "./branding.server";

export interface CompanySetupSettings {
  vatRate: string;
  invoicePrefix: string;
  creditNotePrefix: string;
  taxInclusive: boolean;
}

export interface CompanySetupLegalEntity {
  legalName: string;
  tradeName: string;
  trn: string;
  tin: string;
  tradeLicence: string;
  vatStatus: string;
  businessEmail: string;
  businessPhone: string;
  emirate: string;
  city: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  country: string;
}

export interface CompanySetupData {
  settings: CompanySetupSettings;
  socialLinks: StoreSocialLinksInput;
  legalEntity: CompanySetupLegalEntity;
}

export class OnboardingError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OnboardingError";
    this.status = status;
  }
}

const DEFAULT_SETTINGS: CompanySetupSettings = {
  vatRate: "5",
  invoicePrefix: "INV-",
  creditNotePrefix: "CN-",
  taxInclusive: false,
};

const EMPTY_LEGAL_ENTITY: CompanySetupLegalEntity = {
  legalName: "",
  tradeName: "",
  trn: "",
  tin: "",
  tradeLicence: "",
  vatStatus: "registered",
  businessEmail: "",
  businessPhone: "",
  emirate: "",
  city: "",
  addressLine1: "",
  addressLine2: "",
  postalCode: "",
  country: "",
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

async function loadStoreSettings(
  storeId: string,
  merchantId: string,
): Promise<CompanySetupSettings> {
  const keys = [
    "vat_rate",
    "invoice_prefix",
    "credit_note_prefix",
    "tax_inclusive",
  ];
  const rows = await prisma.setting.findMany({
    where: {
      storeId,
      merchantId,
      key: { in: keys },
    },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    vatRate:
      typeof map.vat_rate === "string" || typeof map.vat_rate === "number"
        ? String(map.vat_rate)
        : "5",
    invoicePrefix:
      typeof map.invoice_prefix === "string" ? map.invoice_prefix : "INV-",
    creditNotePrefix:
      typeof map.credit_note_prefix === "string"
        ? map.credit_note_prefix
        : "CN-",
    taxInclusive:
      map.tax_inclusive === true || map.tax_inclusive === "true",
  };
}

async function upsertTaxIdentifier(
  legalEntityId: string,
  identifierType: "trn" | "tin" | "trade_licence",
  value: string | undefined,
) {
  const trimmed = value?.trim();
  if (!trimmed) {
    await prisma.taxIdentifier.deleteMany({
      where: { legalEntityId, identifierType },
    });
    return;
  }
  await prisma.taxIdentifier.upsert({
    where: {
      legalEntityId_identifierType: { legalEntityId, identifierType },
    },
    create: {
      legalEntityId,
      identifierType,
      value: trimmed,
      issuingAuthority: "Tax authority",
      verifiedStatus: "pending",
    },
    update: {
      value: trimmed,
      issuingAuthority: "Tax authority",
      verifiedStatus: "pending",
    },
  });
}

export async function loadCompanySetup(
  shopDomain: string,
): Promise<CompanySetupData> {
  const store = await prisma.store.findUnique({
    where: { shopifyDomain: shopDomain },
  });

  const legalEntityRow = store?.defaultLegalEntityId
    ? await prisma.legalEntity.findUnique({
        where: { id: store.defaultLegalEntityId },
      })
    : null;

  const settings = store
    ? await loadStoreSettings(store.id, store.merchantId)
    : { ...DEFAULT_SETTINGS };

  const socialLinks =
    (await getSocialLinksForShop(shopDomain)) ?? { showOnInvoice: false };

  const address = asAddress(legalEntityRow?.address);
  const countryFallback =
    store?.currency?.slice(0, 2)?.toUpperCase() ?? "";

  return {
    settings,
    socialLinks,
    legalEntity: legalEntityRow
      ? {
          legalName: legalEntityRow.legalName ?? "",
          tradeName: legalEntityRow.tradeName ?? "",
          trn: legalEntityRow.trn ?? "",
          tin: legalEntityRow.tin ?? "",
          tradeLicence: legalEntityRow.tradeLicence ?? "",
          vatStatus: legalEntityRow.vatStatus ?? "registered",
          businessEmail: legalEntityRow.businessEmail ?? "",
          businessPhone: legalEntityRow.businessPhone ?? "",
          emirate: legalEntityRow.emirate ?? "",
          city: address.city ?? "",
          addressLine1: address.line1 ?? "",
          addressLine2: address.line2 ?? "",
          postalCode: address.postalCode ?? "",
          country: address.country ?? countryFallback,
        }
      : {
          ...EMPTY_LEGAL_ENTITY,
          country: countryFallback,
        },
  };
}

export async function saveCompanySetup(
  shopDomain: string,
  body: Record<string, unknown>,
): Promise<CompanySetupData> {
  const store = await prisma.store.findUnique({
    where: { shopifyDomain: shopDomain },
  });
  if (!store) {
    throw new OnboardingError(404, "Store not found");
  }

  const legalName =
    typeof body.legalName === "string" ? body.legalName.trim() : "";
  const tradeName =
    typeof body.tradeName === "string" ? body.tradeName.trim() : "";
  const trn = typeof body.trn === "string" ? body.trn.trim() : "";
  let tin = typeof body.tin === "string" ? body.tin.trim() : "";
  const tradeLicence =
    typeof body.tradeLicence === "string" ? body.tradeLicence.trim() : "";
  const businessEmail =
    typeof body.businessEmail === "string" ? body.businessEmail.trim() : "";
  const businessPhone =
    typeof body.businessPhone === "string" ? body.businessPhone.trim() : "";
  const emirate = typeof body.emirate === "string" ? body.emirate.trim() : "";
  const countryRaw =
    typeof body.country === "string" ? body.country.trim().toUpperCase() : "";
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const addressLine1 =
    typeof body.addressLine1 === "string" ? body.addressLine1.trim() : "";
  const addressLine2 =
    typeof body.addressLine2 === "string" ? body.addressLine2.trim() : "";
  const postalCode =
    typeof body.postalCode === "string" ? body.postalCode.trim() : "";
  const vatStatus =
    body.vatStatus === "not_registered" ||
    (!trn && body.vatStatus !== "registered")
      ? ("not_registered" as const)
      : ("registered" as const);
  const defaultCurrency = (store.currency || "USD").toUpperCase();
  const country =
    countryRaw.length === 2
      ? countryRaw
      : countryRaw.slice(0, 2) || defaultCurrency.slice(0, 2) || "US";
  const vatRate =
    typeof body.vatRate === "string"
      ? body.vatRate
      : String(body.vatRate ?? "5");
  const invoicePrefix =
    typeof body.invoicePrefix === "string"
      ? body.invoicePrefix.trim() || "INV-"
      : "INV-";
  const creditNotePrefix =
    typeof body.creditNotePrefix === "string"
      ? body.creditNotePrefix.trim() || "CN-"
      : "CN-";
  const taxInclusive =
    body.taxInclusive === "true" || body.taxInclusive === true;

  if (!tin && trn.replace(/\D/g, "").length >= 10) {
    tin = trn.replace(/\D/g, "").slice(0, 10);
  }

  if (!legalName || !businessEmail || !addressLine1 || !city || !country) {
    throw new OnboardingError(
      400,
      "Please complete all required business identity and address fields.",
    );
  }
  if (vatStatus === "registered" && !trn) {
    throw new OnboardingError(
      400,
      "Tax registration number is required when your business is VAT registered.",
    );
  }
  if (!businessPhone) {
    throw new OnboardingError(400, "Business phone is required.");
  }

  const entityData = {
    merchantId: store.merchantId,
    legalName,
    tradeName: tradeName || null,
    trn: trn || null,
    tin: tin || null,
    tradeLicence: tradeLicence || null,
    businessEmail,
    businessPhone: businessPhone || null,
    emirate: emirate || null,
    vatStatus,
    defaultCurrency,
    address: {
      line1: addressLine1,
      line2: addressLine2 || undefined,
      city,
      emirate: emirate || undefined,
      postalCode: postalCode || undefined,
      country,
    } satisfies AddressJson,
  };

  let legalEntityId = store.defaultLegalEntityId;
  if (legalEntityId) {
    const existing = await prisma.legalEntity.findUnique({
      where: { id: legalEntityId },
    });
    if (existing) {
      await prisma.legalEntity.update({
        where: { id: legalEntityId },
        data: entityData,
      });
    } else {
      const created = await prisma.legalEntity.create({ data: entityData });
      legalEntityId = created.id;
      await prisma.store.update({
        where: { id: store.id },
        data: { defaultLegalEntityId: legalEntityId },
      });
    }
  } else {
    const created = await prisma.legalEntity.create({ data: entityData });
    legalEntityId = created.id;
    await prisma.store.update({
      where: { id: store.id },
      data: { defaultLegalEntityId: legalEntityId },
    });
  }

  await upsertTaxIdentifier(legalEntityId, "trn", trn);
  await upsertTaxIdentifier(legalEntityId, "tin", tin);
  await upsertTaxIdentifier(legalEntityId, "trade_licence", tradeLicence);

  const settings = [
    { key: "vat_rate", value: vatRate || "5" },
    { key: "invoice_prefix", value: invoicePrefix },
    { key: "credit_note_prefix", value: creditNotePrefix },
    { key: "tax_inclusive", value: taxInclusive },
  ];

  for (const s of settings) {
    await prisma.setting.upsert({
      where: {
        merchantId_storeId_key: {
          merchantId: store.merchantId,
          storeId: store.id,
          key: s.key,
        },
      },
      create: {
        merchantId: store.merchantId,
        storeId: store.id,
        scope: "store",
        key: s.key,
        value: s.value,
      },
      update: {
        merchantId: store.merchantId,
        storeId: store.id,
        scope: "store",
        key: s.key,
        value: s.value,
      },
    });
  }

  await saveSocialLinksForShop(
    shopDomain,
    parseSocialLinksFromForm(body),
  );

  console.log(`[onboarding] legal entity saved for ${shopDomain}`);

  return loadCompanySetup(shopDomain);
}
