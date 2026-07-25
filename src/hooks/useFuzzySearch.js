import { useMemo, useState } from 'react';
import Fuse from 'fuse.js';

// Fuzzy-filters `items` by `query` across `keys`. Returns items unchanged when
// the query is empty so callers don't need a separate "no search" branch.
export function useFuzzySearch(items, keys, options) {
  const [query, setQuery] = useState('');

  const fuse = useMemo(
    () => new Fuse(items, { keys, threshold: 0.3, ignoreLocation: true, ...options }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, JSON.stringify(keys)]
  );

  const results = useMemo(() => {
    if (!query.trim()) return items;
    // Filter by refIndex rather than returning fuse's relevance-sorted order,
    // so the list keeps its original sort (date, name, etc.) while searching.
    const matched = new Set(fuse.search(query).map((r) => r.refIndex));
    return items.filter((_, i) => matched.has(i));
  }, [fuse, query, items]);

  return { query, setQuery, results };
}
