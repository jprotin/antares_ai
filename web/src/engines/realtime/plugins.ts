// Points d'extension de l'appel (TASK-43) : une fonctionnalité (la Répétition) suit les
// événements, retient le micro ou se tait, sans modifier le moteur.
import type { ServerEvent } from "./protocol";

export type CallPlugin = {
  id: string;
  // Chaque événement du serveur, avant le traitement de l'appel
  onEvent?(event: ServerEvent): void;
  // Le plugin affiche lui-même la parole (pas de sous-titres dans la conversation)
  active?(): boolean;
  // Fin de parole sans réflexion attendue (l'interface reste « à l'écoute »)
  silent?(): boolean;
  // Micro retenu tant que l'avatar parle (et pendant la traîne d'écho)
  holdMic?(): boolean;
  onCallEnded?(reason: string): void;
};

export class PluginHost {
  private readonly plugins: CallPlugin[] = [];

  register(plugin: CallPlugin): () => void {
    this.plugins.push(plugin);
    return () => {
      const index = this.plugins.indexOf(plugin);
      if (index >= 0) this.plugins.splice(index, 1);
    };
  }

  event(event: ServerEvent) {
    for (const plugin of this.plugins) plugin.onEvent?.(event);
  }

  active(): boolean {
    return this.plugins.some((plugin) => plugin.active?.());
  }

  silent(): boolean {
    return this.plugins.some((plugin) => plugin.silent?.());
  }

  holdMic(): boolean {
    return this.plugins.some((plugin) => plugin.holdMic?.());
  }

  callEnded(reason: string) {
    for (const plugin of this.plugins) plugin.onCallEnded?.(reason);
  }
}
