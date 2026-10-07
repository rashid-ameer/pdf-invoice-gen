import type { Store } from "@prisma/client";

import { NoOpAdapter } from "./no-op.adapter";
import type { AspAdapter } from "./types";

/**
 * Old getAspAdapter: compliance + aspConnectionId still returns NoOp because
 * StorecoveAdapter is TODO. Never invent a live submission path here.
 */
export function getAspAdapter(
  store: Pick<Store, "invoiceMode" | "aspConnectionId">,
): AspAdapter {
  if (store.invoiceMode === "compliance" && store.aspConnectionId) {
    // TODO Phase 2: return new StorecoveAdapter(store.aspConnectionId)
    console.warn(
      "[asp] compliance mode enabled but StorecoveAdapter not implemented yet",
    );
  }

  return new NoOpAdapter();
}

export { NoOpAdapter } from "./no-op.adapter";
export type { AspAdapter } from "./types";
