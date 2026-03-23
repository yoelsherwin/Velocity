import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadInitialSession } from "./components/layout/TabManager";

// Load session state before first render so TabManager can restore tabs synchronously
loadInitialSession().finally(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
