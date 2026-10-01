import type { Address, SellerInfo } from "../types";
import { PINT_TAX_SCHEME_VAT } from "./pint.constants";

export { PINT_TAX_SCHEME_VAT };
function normalizeAddress(
  address?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    emirate?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null,
): Address {
  return {
    line1: address?.line1?.trim() || "",
    line2: address?.line2?.trim() || undefined,
    city: address?.city?.trim() || "",
    emirate: address?.emirate?.trim() || undefined,
    postalCode: address?.postalCode?.trim() || undefined,
    country: address?.country?.trim() || "",
  };
}

export function buildSellerSnapshot(legalEntity: {
  legalName: string;
  tradeName?: string | null;
  trn?: string | null;
  tin?: string | null;
  tradeLicence?: string | null;
  businessEmail?: string | null;
  businessPhone?: string | null;
  address?: {
    line1?: string | null;
    line2?: string | null;
    city?: string | null;
    emirate?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null;
  emirate?: string | null;
}): SellerInfo {
  const address = normalizeAddress(legalEntity.address);
  return {
    legalName: legalEntity.legalName,
    tradeName: legalEntity.tradeName ?? undefined,
    trn: legalEntity.trn ?? undefined,
    tin: legalEntity.tin ?? undefined,
    tradeLicence: legalEntity.tradeLicence ?? undefined,
    businessEmail: legalEntity.businessEmail ?? undefined,
    businessPhone: legalEntity.businessPhone ?? undefined,
    taxSchemeCode: PINT_TAX_SCHEME_VAT,
    address,
    emirate: legalEntity.emirate ?? address.emirate,
  };
}

/**
 * Old order-webhook fallback when the store has no legal entity.
 * Preserves country: store.currency?.slice(0, 2) even though that looks odd.
 */
export function buildFallbackSellerSnapshot(
  shopDomain: string,
  currency?: string | null,
): SellerInfo {
  return buildSellerSnapshot({
    legalName: shopDomain,
    address: {
      line1: shopDomain,
      city: "",
      country: currency?.slice(0, 2) || "",
    },
  });
}
