import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasActiveInvoiceUiFilters } from "../app/utils/invoice-ui-filters";

describe("hasActiveInvoiceUiFilters", () => {
  it("treats empty defaults as inactive", () => {
    assert.equal(
      hasActiveInvoiceUiFilters({ q: "", status: "", from: "", to: "" }),
      false,
    );
    assert.equal(
      hasActiveInvoiceUiFilters({ q: "", status: "all", from: "", to: "" }),
      false,
    );
  });

  it("detects search, status, and date range as active", () => {
    assert.equal(
      hasActiveInvoiceUiFilters({
        q: "INV-1",
        status: "",
        from: "",
        to: "",
      }),
      true,
    );
    assert.equal(
      hasActiveInvoiceUiFilters({
        q: "",
        status: "generated",
        from: "",
        to: "",
      }),
      true,
    );
    assert.equal(
      hasActiveInvoiceUiFilters({
        q: "",
        status: "",
        from: "2024-01-01",
        to: "",
      }),
      true,
    );
    assert.equal(
      hasActiveInvoiceUiFilters({
        q: "",
        status: "",
        from: "",
        to: "2024-12-31",
      }),
      true,
    );
  });
});
