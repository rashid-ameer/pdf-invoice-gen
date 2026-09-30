export function formatAmount(value: number): string {
  return value.toFixed(2);
}

/** Line-item discount as a percentage of qty × unit price. Totals still use amounts. */
export function formatDiscountPercent(
  discountAmount: number,
  quantity: number,
  unitPrice: number,
): string {
  const gross = quantity * unitPrice;
  if (!(gross > 0) || !(discountAmount > 0)) return "0%";
  const pct = (discountAmount / gross) * 100;
  const rounded = Math.round(pct * 100) / 100;
  return `${rounded}%`;
}
