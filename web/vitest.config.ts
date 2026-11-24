import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      // Logique pure (stratégie de tests, §15) ; le moteur audio, l'avatar et le
      // WebSocket (CallEngine, playback, voiceEffects, AvatarHost) relèvent de Playwright
      include: [
        "src/lib/**",
        "src/state/**",
        "src/engines/theme/**",
        "src/engines/net/**",
        "src/engines/realtime/protocol.ts",
        "src/engines/realtime/plugins.ts",
        // Répétition : logique pure (les composants relèvent de Playwright)
        "src/features/rehearsal/rehearsalMachine.ts",
        "src/features/rehearsal/audio/**",
        // Veille IA et météo : logique pure (cible 100 %)
        "src/features/veille/veille.ts",
        "src/features/veille/stats.ts",
        // Présidentielle 2027 : tirage au sort de l'ordre des candidats, proximité,
        // barres à deux pôles et mémoire du quiz (cible 100 %)
        "src/features/presidentielle/shuffle.ts",
        "src/features/presidentielle/proximity.ts",
        "src/features/presidentielle/poles.ts",
        "src/features/presidentielle/quizStorage.ts",
        // Assistant : envoi et mise en attente pendant un appel
        "src/features/presidentielle/assistant.ts",
      ],
      thresholds: { lines: 85 },
    },
  },
});
