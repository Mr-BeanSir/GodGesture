function normalizePositiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function getPageItems<T>(
  items: readonly T[],
  page: number,
  pageSize: number,
): T[] {
  const normalizedPage = normalizePositiveInteger(page, 1);
  const normalizedPageSize = normalizePositiveInteger(pageSize, 10);
  const start = (normalizedPage - 1) * normalizedPageSize;
  return items.slice(start, start + normalizedPageSize);
}

export function getPageCount(total: number, pageSize: number): number {
  const normalizedTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  const normalizedPageSize = normalizePositiveInteger(pageSize, 10);
  return Math.max(1, Math.ceil(normalizedTotal / normalizedPageSize));
}
