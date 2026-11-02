import { useCallback, useEffect, useRef, useState } from "react";

// A list that arrives from the API in pages.
// It shows the first page, loads more on request, and starts again when `params`
// change (a new search or filter).
//   fetchPage(params)  returns { [listKey]: [...], total, ...anything else }
// Returns { items, total, extra, loaded, loading, loadingMore, error, loadMore, reload }.
//   extra   the rest of the answer, for example the inventory counts
//   reload  fetches again what is on screen (up to MAX_RELOAD rows), so the numbers
//           are fresh without losing your place
// `fetchPage` must be a stable function, such as one imported from api.js.
const MAX_RELOAD = 200;
const EMPTY = { items: [], total: 0, extra: {}, loaded: false, error: null };

function readPage(body, listKey) {
  const { [listKey]: items, total, limit, offset, ...extra } = body;
  return { items, total, extra };
}

export function usePagedList(fetchPage, listKey, params, pageSize = 24) {
  const [state, setState] = useState(EMPTY);
  const [loadingMore, setLoadingMore] = useState(false);
  const latest = useRef(0); // an answer to an older request is ignored
  const shown = useRef(0);
  const key = JSON.stringify(params);
  shown.current = state.items.length;

  const load = useCallback(
    async (limit) => {
      const id = ++latest.current;
      try {
        const body = await fetchPage({ ...JSON.parse(key), limit, offset: 0 });
        if (id === latest.current) setState({ ...readPage(body, listKey), loaded: true, error: null });
      } catch (error) {
        if (id === latest.current) setState((current) => ({ ...current, error }));
      }
    },
    [fetchPage, listKey, key],
  );

  // A new search or filter starts again from the first page.
  useEffect(() => {
    setState(EMPTY);
    load(pageSize);
  }, [load, pageSize]);

  const reload = useCallback(() => load(Math.min(MAX_RELOAD, Math.max(pageSize, shown.current))), [load, pageSize]);

  const loadMore = useCallback(async () => {
    const id = latest.current;
    setLoadingMore(true);
    try {
      const body = await fetchPage({ ...JSON.parse(key), limit: pageSize, offset: shown.current });
      if (id !== latest.current) return;
      setState((current) => {
        const page = readPage(body, listKey);
        const seen = new Set(current.items.map((item) => item.id));
        const added = page.items.filter((item) => !seen.has(item.id));
        return { ...current, ...page, items: [...current.items, ...added], error: null };
      });
    } catch (error) {
      if (id === latest.current) setState((current) => ({ ...current, error }));
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, listKey, key, pageSize]);

  return { ...state, loading: !state.loaded && !state.error, loadingMore, loadMore, reload };
}
