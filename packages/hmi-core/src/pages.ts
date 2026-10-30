/**
 * Cursor pagination, as the API serves history (measurements and alarms): each
 * call returns a page and the cursor of the next one.
 */

export interface Page<T> {
  items: T[];
  /** Cursor for the next page, or null on the last one. */
  next: string | null;
}

export interface PageRequest {
  /** Rows per page, 1 to 10,000. A page can be shorter while more follow. */
  first?: number;
  /** The `next` cursor of the previous page, with the same filter and order. */
  after?: string;
}

/** The largest page the API serves. */
export const PAGE_MAX = 10_000;

/** Follows the cursor until the last page or `maxRows`, and returns the rows in order. */
export async function collectPages<T>(
  fetchPage: (page: PageRequest) => Promise<Page<T>>,
  options: { pageSize: number; maxRows: number },
): Promise<T[]> {
  const out: T[] = [];
  let after: string | undefined;
  do {
    const page = await fetchPage({ first: options.pageSize, ...(after ? { after } : {}) });
    out.push(...page.items);
    after = page.next ?? undefined;
  } while (after && out.length < options.maxRows);
  return out.slice(0, options.maxRows);
}
