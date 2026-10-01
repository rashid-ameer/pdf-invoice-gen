/** Structured e-invoice profile constants (Peppol / ASP submission). */
export const PINT_AE_SPECIFICATION_ID =
  "urn:peppol:schema:ubl-invoice:2::PINT_AE_1.0.3#PINT_AE_1.0.3";

export const PINT_AE_BUSINESS_PROCESS = "urn:peppol:bis:billing:3.0";

export const PINT_AE_ELECTRONIC_ADDRESS_SCHEME = "0235";

export const PINT_INVOICE_TYPE_TAX = "380";
export const PINT_INVOICE_TYPE_CREDIT = "381";

/** Default B2C retail transaction type (supply of goods/services). */
export const PINT_TRANSACTION_TYPE_DEFAULT = "0100000";

/** Credit transfer / unspecified electronic payment. */
export const PINT_PAYMENT_MEANS_DEFAULT = "30";

/** UN/ECE Recommendation 20 — unit (each). */
export const PINT_UNIT_EACH = "C62";

export const PINT_TAX_SCHEME_VAT = "VAT";

/** Standard rated supply. */
export const PINT_TAX_CATEGORY_STANDARD = "S";

/** Zero rated. */
export const PINT_TAX_CATEGORY_ZERO = "Z";

/** Out of scope / exempt placeholder when no VAT applies. */
export const PINT_TAX_CATEGORY_EXEMPT = "E";

export const PINT_SELLER_REGISTRATION_SCHEME_TRADE_LICENCE = "TL";
