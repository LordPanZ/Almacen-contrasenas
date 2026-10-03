import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./estilos.css";

const raiz = document.getElementById("raiz");
if (!raiz) throw new Error("falta el nodo raíz");

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
