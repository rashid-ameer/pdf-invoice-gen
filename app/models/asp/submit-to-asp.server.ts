/**
 * Old submitToAspJob — callable helper only. Workers do not enqueue this queue.
 */
import prisma from "../../db.server";
import { getAspAdapter } from "./factory";
import type { AspDocumentPayload, SubmitResult } from "./types";

export async function submitToAspJob(data: {
  storeId: string;
  invoiceId: string;
  invoice: AspDocumentPayload;
}): Promise<SubmitResult & { invoiceId: string }> {
  const store = await prisma.store.findUnique({ where: { id: data.storeId } });
  if (!store) throw new Error(`Store not found: ${data.storeId}`);

  const adapter = getAspAdapter(store);
  const result = await adapter.submitInvoice(data.invoice);

  return {
    invoiceId: data.invoiceId,
    ...result,
  };
}
