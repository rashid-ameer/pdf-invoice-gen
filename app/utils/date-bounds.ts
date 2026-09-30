/** Inclusive calendar day in Dubai (+04:00), matching the old invoice list filter. */
export function dubaiDayBounds(
  from: string,
  to: string,
): { gte?: Date; lte?: Date } | undefined {
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = new Date(`${from}T00:00:00.000+04:00`);
  if (to) range.lte = new Date(`${to}T23:59:59.999+04:00`);
  if (!range.gte && !range.lte) return undefined;
  return range;
}
