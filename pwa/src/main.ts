import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import { registerSW } from "virtual:pwa-register";

import { start } from "./app";
import "./styles.css";

registerSW({ immediate: true });

const viewport = window.visualViewport;
function placeKeyboard(): void {
  if (!viewport) return;
  const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
  const open = inset > 80;
  document.documentElement.style.setProperty("--keyboard", open ? `${Math.round(inset)}px` : "0px");
  document.documentElement.style.setProperty(
    "--tabs",
    open ? "0px" : "calc(64px + env(safe-area-inset-bottom))",
  );
}
viewport?.addEventListener("resize", placeKeyboard);
viewport?.addEventListener("scroll", placeKeyboard);

void start();
