export type InvoiceMode = "standard" | "compliance";

export type InvoiceStatus =
  | "draft"
  | "generated"
  | "ready"
  | "downloaded"
  | "submitted"
  | "accepted"
  | "rejected"
  | "pending"
  | "delivered"
  | "failed";

export type UserRole = "owner" | "admin" | "finance" | "read_only";

export type ValidationMode = "warn" | "block";

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  emirate?: string;
  postalCode?: string;
  country?: string;
}

export interface InvoiceLineItem {
  lineId?: string;
  sku?: string;
  description: string;
  productTitle?: string;
  variantTitle?: string;
  imageUrl?: string;
  barcode?: string;
  quantity: number;
  unitOfMeasure?: string;
  unitPrice: number;
  discount: number;
  vatRate: number;
  vatAmount: number;
  lineNetAmount?: number;
  taxCategoryCode?: string;
  lineTotal: number;
}

export interface InvoiceTotals {
  subtotal: number;
  discount: number;
  vatTotal: number;
  shipping: number;
  grandTotal: number;
  totalWithoutTax?: number;
  amountDue?: number;
}

export interface SellerInfo {
  legalName: string;
  tradeName?: string;
  trn?: string;
  tin?: string;
  tradeLicence?: string;
  businessEmail?: string;
  businessPhone?: string;
  taxSchemeCode?: string;
  address: Address;
  emirate?: string;
}

export interface BuyerInfo {
  name: string;
  legalName?: string;
  trn?: string;
  tin?: string;
  taxSchemeCode?: string;
  email?: string;
  phone?: string;
  address?: Address;
}

export interface PintTaxBreakdownRow {
  categoryCode: string;
  rate: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface PintInvoiceMetadata {
  invoiceTypeCode: string;
  transactionTypeCode: string;
  specificationId: string;
  businessProcessType: string;
  paymentMeansCode: string;
  dueDate?: Date;
  sumLineNetAmount: number;
  totalWithoutTax: number;
  amountDue: number;
  taxBreakdown: PintTaxBreakdownRow[];
}

export type DocumentType =
  | "tax_invoice"
  | "credit_note"
  | "packing_slip"
  | "refund_document";
