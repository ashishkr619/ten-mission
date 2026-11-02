import { useEffect, useState } from "react";

// The value, but only once it has stopped changing for `delay` ms, so typing in a
// search box does not send a request for every key.
export function useDebounced(value, delay = 300) {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}
