import "@khorde/hmi-theme/index.css";
import "./app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { boot } from "./boot.ts";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
const reactRoot = createRoot(root);

boot().then(
  (booted) =>
    reactRoot.render(
      <StrictMode>
        <App booted={booted} />
      </StrictMode>,
    ),
  (error: unknown) =>
    // No dictionary yet if the config failed: a plain message is all there is.
    reactRoot.render(
      <div className="boot-screen boot-screen--error" role="alert">
        <h1>The HMI could not start</h1>
        <pre>{error instanceof Error ? error.message : String(error)}</pre>
      </div>,
    ),
);
