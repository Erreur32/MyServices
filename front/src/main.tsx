import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { TooltipLayer } from "./components/TooltipLayer";
import "./index.css";
import { savedTheme } from "./theme";
import { LANG } from "./lib/i18n";

// Thème posé avant le premier rendu : pas d'éclair sombre / clair au chargement
document.documentElement.classList.toggle("light", savedTheme() === "light");
document.documentElement.lang = LANG;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <TooltipLayer />
  </StrictMode>,
);
