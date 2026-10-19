import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Feuille globale en premier : l'ordre des couches de Tailwind vaut pour tout le reste
import "./index.css";
import "./styles/legacy-shared.css";
import App from "./App.tsx";
import { bootstrap } from "./app/bootstrap";

// Profil, réseau et documents : chargés une fois, hors React (StrictMode rejoue les effets)
bootstrap();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
