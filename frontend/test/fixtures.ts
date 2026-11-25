import type { InvoiceOut } from "@/lib/api/types";

/** A complete invoice as the API returns it; tests override what they care about. */
export function makeInvoice(overrides: Partial<InvoiceOut> = {}): InvoiceOut {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    document_id: "22222222-2222-2222-2222-222222222222",
    status: "needs_review",
    invoice_number: "INV-1",
    invoice_date: "2026-09-01",
    supplier_name: "Acme Supplies Ltd",
    customer_name: "Globex Corp",
    currency: "USD",
    subtotal: "100.00",
    tax: "10.00",
    total: "110.00",
    confidence: {},
    corrected_fields: [],
    corrections: [],
    issues: [],
    line_items: [],
    method: "llm",
    model: "groq:test",
    page_numbers: [1],
    archived_at: null,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}
