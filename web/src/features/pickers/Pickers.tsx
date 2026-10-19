// Agent et mode (haut de l'écran d'appel) : en tête, les agents dont l'utilité
// correspond au mode ; puis tous les agents par domaine (port de renderPickers, app.js)
import { applyAgentHue, saveSetting } from "@/app/bootstrap";
import { hueFor } from "@/engines/theme/theme";
import { useAppStore } from "@/state/hooks";
import { store } from "@/state/store";
import type { Agent, Settings } from "@/types/api";

import { Picker, type PickerGroup } from "./Picker";
import "./pickers.css";

const MAX_SUGGESTED = 5;

async function choose(update: Settings) {
  try {
    await saveSetting(update);
    applyAgentHue();
  } catch (error) {
    store.getState().setStatus(`Réglage refusé : ${(error as Error).message}`);
  }
}

const agentItem = (agent: Agent) => ({
  value: agent.id,
  label: agent.name,
  detail: agent.description || agent.usage,
  hue: hueFor(agent.domain),
});

export function Pickers() {
  const agents = useAppStore((state) => state.agents);
  const modes = useAppStore((state) => state.modes);
  const settings = useAppStore((state) => state.settings);
  const mode = modes.find((m) => m.id === settings?.mode) ?? modes[0];
  const suggested = agents
    .filter(
      (agent) =>
        agent.usage !== undefined && mode?.usages.includes(agent.usage),
    )
    .slice(0, MAX_SUGGESTED);
  const domains = [...new Set(agents.map((agent) => agent.domain ?? ""))].sort(
    (a, b) => a.localeCompare(b),
  );
  const agentGroups: PickerGroup[] = [
    {
      items: [
        {
          value: "",
          label: "Aucun",
          detail: "Sauf agent cité par son nom",
          hue: hueFor(undefined),
        },
      ],
    },
    ...(suggested.length && mode
      ? [{ label: `Suggérés · ${mode.name}`, items: suggested.map(agentItem) }]
      : []),
    ...domains.map((domain) => ({
      label: domain,
      items: agents
        .filter((agent) => (agent.domain ?? "") === domain)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(agentItem),
    })),
  ];
  const modeGroups: PickerGroup[] = [
    {
      items: modes.map((m) => ({
        value: m.id,
        label: m.name,
        detail: m.description,
      })),
    },
  ];
  return (
    <div className="stage__pickers">
      <Picker
        label="Agent"
        searchable
        groups={agentGroups}
        selected={settings?.agent ?? ""}
        onSelect={(agent) => void choose({ agent })}
      />
      <Picker
        label="Mode"
        groups={modeGroups}
        selected={mode?.id ?? ""}
        onSelect={(value) => void choose({ mode: value })}
      />
    </div>
  );
}
