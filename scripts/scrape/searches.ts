/** The renthub searches the scraper runs. */
export const SEARCHES = [
  { key: "daily", rentalPath: "short-term-rental", zone: "chiang-mai", rentalType: "DAILY" },
  // TODO(monthly): { key: "monthly", rentalPath: "apartment", zone: "chiang-mai", rentalType: "MONTHLY" },
] as const;

export type Search = (typeof SEARCHES)[number];
export type SearchKey = Search["key"];

export function findSearch(key: string): Search | undefined {
  return SEARCHES.find((search) => search.key === key);
}
