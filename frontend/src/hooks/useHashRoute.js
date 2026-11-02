import { useEffect, useState } from "react";

// Pages live in the URL hash (#/book?item=3). There is no router library and
// no server setup: a refresh or a shared link opens the same page.
function readRoute() {
  const [path, query = ""] = window.location.hash.replace(/^#/, "").split("?");
  return { path: path || "/inventory", params: new URLSearchParams(query) };
}

export function useHashRoute() {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}
