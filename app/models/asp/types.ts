/**
 * Group 16 — ASP adapter contracts (old server/adapters/asp/types.ts).
 * Storecove remains unimplemented; NoOp is the live adapter.
 */

export interface AspEntityResult {
  externalId: string;
  participantId?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface SubmitResult {
  status: "submitted" | "skipped" | "failed";
  externalId?: string;
  message?: string;
  payloadRef?: string;
}

export interface StatusResult {
  status: string;
  externalId: string;
  message?: string;
  updatedAt?: Date;
}

export interface WebhookResult {
  externalId: string;
  status: string;
  message?: string;
}

export interface ParticipantResult {
  participantId: string;
  legalName: string;
  trn?: string;
}

export interface TaxIdentifiers {
  trn?: string;
  tin?: string;
  tradeLicence?: string;
  participantId?: string;
}

/** Opaque document payload for submit/validate stubs (old CanonicalInvoice). */
export type AspDocumentPayload = Record<string, unknown>;

export interface AspAdapter {
  readonly providerCode: string;
  createLegalEntity(data: {
    legalEntityId: string;
    storeId: string;
  }): Promise<AspEntityResult>;
  updateIdentifiers(entityId: string, ids: TaxIdentifiers): Promise<void>;
  validateInvoice(invoice: AspDocumentPayload): Promise<ValidationResult>;
  submitInvoice(invoice: AspDocumentPayload): Promise<SubmitResult>;
  submitCreditNote(creditNote: AspDocumentPayload): Promise<SubmitResult>;
  getStatus(externalId: string): Promise<StatusResult>;
  handleWebhook(
    headers: Record<string, string>,
    body: unknown,
  ): Promise<WebhookResult>;
  lookupParticipant(trn: string): Promise<ParticipantResult | null>;
}
