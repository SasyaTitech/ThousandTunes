import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import Picker from "@/Picker";
import Practice from "@/Practice";
import MainWindow from "@/MainWindow";
import "@/styles.css";
import "@/main-window.css";

// One bundle shared by the widget, colour picker and practice settings.
const view = new URLSearchParams(window.location.search).get("view");
const picker = view === "accent";
const practice = view === "practice";
const main = view === "main";
if (picker) document.documentElement.classList.add("td-picker-page");
if (practice) document.documentElement.classList.add("td-practice-page");
if (main) {
  document.documentElement.classList.add("td-main-page");
  // Before the first paint, so the window never flashes the default palette.
  try { document.documentElement.dataset.skin = localStorage.getItem("td-skin") ?? "mo"; } catch { /* private mode */ }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{main ? <MainWindow /> : practice ? <Practice /> : picker ? <Picker /> : <App />}</React.StrictMode>,
);
