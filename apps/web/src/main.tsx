import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import { Privacy } from "./pages/Privacy.js";
import { Terms } from "./pages/Terms.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import "./index.css";

// Minimal path-based routing — the static host / API serve index.html for these
// paths (SPA fallback), and we render the matching page. No router dependency.
function Root() {
  switch (window.location.pathname) {
    case "/privacy":
      return <Privacy />;
    case "/terms":
      return <Terms />;
    default:
      return <App />;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
);
