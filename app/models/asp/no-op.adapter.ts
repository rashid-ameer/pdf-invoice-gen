import type {
  AspAdapter,
  AspDocumentPayload,
  AspEntityResult,
  ParticipantResult,
  StatusResult,
  SubmitResult,
  TaxIdentifiers,
  ValidationResult,
  WebhookResult,
} from "./types";

/** Old NoOpAdapter — always skips submission. */
export class NoOpAdapter implements AspAdapter {
  readonly providerCode = "noop";

  async createLegalEntity(_data: {
    legalEntityId: string;
    storeId: string;
  }): Promise<AspEntityResult> {
    return { externalId: "noop", participantId: undefined };
  }

  async updateIdentifiers(
    _entityId: string,
    _ids: TaxIdentifiers,
  ): Promise<void> {
    return;
  }

  async validateInvoice(
    _invoice: AspDocumentPayload,
  ): Promise<ValidationResult> {
    return { valid: true, errors: [], warnings: [] };
  }

  async submitInvoice(_invoice: AspDocumentPayload): Promise<SubmitResult> {
    return {
      status: "skipped",
      message: "ASP not connected — compliance mode disabled",
    };
  }

  async submitCreditNote(
    _creditNote: AspDocumentPayload,
  ): Promise<SubmitResult> {
    return {
      status: "skipped",
      message: "ASP not connected — compliance mode disabled",
    };
  }

  async getStatus(externalId: string): Promise<StatusResult> {
    return {
      status: "skipped",
      externalId,
      message: "ASP not connected",
    };
  }

  async handleWebhook(
    _headers: Record<string, string>,
    _body: unknown,
  ): Promise<WebhookResult> {
    return {
      externalId: "noop",
      status: "skipped",
      message: "ASP webhooks not enabled",
    };
  }

  async lookupParticipant(_trn: string): Promise<ParticipantResult | null> {
    return null;
  }
}

export const noOpAdapter = new NoOpAdapter();
