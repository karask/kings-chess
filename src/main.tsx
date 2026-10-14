import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { assetUrl } from "../lib/app-url";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(assetUrl("sw.js")).catch(() => undefined);
  });
}
