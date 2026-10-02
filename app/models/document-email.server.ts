/**
 * Group 12 email automation extension points.
 * Group 8 calls these after invoice create / paid webhooks.
 * Implementations are no-ops until Group 12.
 */

export type ScheduleInvoiceAutoEmail = (
  shopDomain: string,
  invoiceId: string,
  orderIsPaid: boolean,
) => Promise<void>;

export type ScheduleInvoiceAutoEmailOnPaid = (
  shopDomain: string,
  invoiceId: string,
) => Promise<void>;

let scheduleInvoiceAutoEmailImpl: ScheduleInvoiceAutoEmail = async () => {};
let scheduleInvoiceAutoEmailOnPaidImpl: ScheduleInvoiceAutoEmailOnPaid =
  async () => {};

/** Injectable for tests — restores to no-op via restoreDocumentEmailHooks(). */
export function setDocumentEmailHooks(hooks: {
  scheduleInvoiceAutoEmail?: ScheduleInvoiceAutoEmail;
  scheduleInvoiceAutoEmailOnPaid?: ScheduleInvoiceAutoEmailOnPaid;
}): void {
  if (hooks.scheduleInvoiceAutoEmail) {
    scheduleInvoiceAutoEmailImpl = hooks.scheduleInvoiceAutoEmail;
  }
  if (hooks.scheduleInvoiceAutoEmailOnPaid) {
    scheduleInvoiceAutoEmailOnPaidImpl = hooks.scheduleInvoiceAutoEmailOnPaid;
  }
}

export function restoreDocumentEmailHooks(): void {
  scheduleInvoiceAutoEmailImpl = async () => {};
  scheduleInvoiceAutoEmailOnPaidImpl = async () => {};
}

export async function scheduleInvoiceAutoEmail(
  shopDomain: string,
  invoiceId: string,
  orderIsPaid: boolean,
): Promise<void> {
  await scheduleInvoiceAutoEmailImpl(shopDomain, invoiceId, orderIsPaid);
}

export async function scheduleInvoiceAutoEmailOnPaid(
  shopDomain: string,
  invoiceId: string,
): Promise<void> {
  await scheduleInvoiceAutoEmailOnPaidImpl(shopDomain, invoiceId);
}
