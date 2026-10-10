import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyWidth, savedTheme, savedWidth } from "./theme";
import { LANG } from "./lib/i18n";

// Thème et largeur posés avant le premier rendu : pas d'éclair sombre / clair ni de saut au chargement
document.documentElement.classList.toggle("light", savedTheme() === "light");
applyWidth(savedWidth());
document.documentElement.lang = LANG;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
