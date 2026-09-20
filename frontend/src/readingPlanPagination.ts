export const READING_PLAN_PAGE_SIZES = [20, 50, 100, 200, 400] as const;

export const READING_PLAN_PAGE_SIZE_STORAGE_KEY = "biy-reading-plan-page-size";

export function readingPlanPageSize(
  urlValue: string | null,
  storedValue: string | null,
) {
  for (const value of [urlValue, storedValue]) {
    const parsed = Number(value);
    if (
      READING_PLAN_PAGE_SIZES.includes(
        parsed as (typeof READING_PLAN_PAGE_SIZES)[number],
      )
    ) {
      return parsed;
    }
  }
  return 20;
}

export function readingPlanPage(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function pageContainingIndex(index: number, pageSize: number) {
  return index >= 0 ? Math.floor(index / pageSize) + 1 : 1;
}
