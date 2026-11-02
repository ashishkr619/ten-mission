import { useCallback, useEffect, useRef, useState } from "react";

// Loads data when the component appears, and again whenever reload() is called.
// Returns { data, error, loading, reload }.
//   - `loading` is true only until the first answer, so a reload after a
//     booking updates the numbers in place instead of flashing a skeleton.
//   - An answer that arrives after a newer request started is ignored.
// `loader` must be a stable function (defined outside the component or wrapped
// in useCallback), because a new loader means "load again".
export function useLoad(loader) {
  const [state, setState] = useState({ data: null, error: null });
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const id = ++latest.current;
    try {
      const data = await loader();
      if (id === latest.current) setState({ data, error: null });
    } catch (error) {
      if (id === latest.current) setState((current) => ({ data: current.data, error }));
    }
  }, [loader]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...state, loading: state.data === null && state.error === null, reload };
}
