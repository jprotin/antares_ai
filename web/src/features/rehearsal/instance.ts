// Contrôleur unique de la Répétition, branché sur le moteur d'appel de l'application
import { engine } from "@/app/runtime";

import { RehearsalController } from "./controller";

export const rehearsal = new RehearsalController(engine);
