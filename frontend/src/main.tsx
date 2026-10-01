import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./design/home.css";
import "./design/study.css";
import "./design/reader.css";
import "./styles.css";
import "./theme.css";
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
