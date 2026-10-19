// Moteurs de l'application, créés une fois (hors React) et partagés par les écrans
import { avatar } from "@/engines/avatar/AvatarHost";
import { CallEngine } from "@/engines/realtime/CallEngine";
import { store } from "@/state/store";

export const engine = new CallEngine(store, avatar);
export { avatar };
