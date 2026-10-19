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
        "src/engines/audio/**",
        "src/engines/net/**",
        "src/engines/realtime/protocol.ts",
        "src/engines/realtime/plugins.ts",
        // Répétition : logique pure (les composants relèvent de Playwright)
        "src/features/rehearsal/rehearsalMachine.ts",
        "src/features/rehearsal/audio/**",
      ],
      thresholds: { lines: 85 },
    },
  },
});
