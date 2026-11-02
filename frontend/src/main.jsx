import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Two fonts, bundled with the app, so nothing is fetched from a font service:
// Newsreader (a refined serif) for headings and names, Instrument Sans for everything else.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/instrument-sans/wght.css";
import "./index.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
