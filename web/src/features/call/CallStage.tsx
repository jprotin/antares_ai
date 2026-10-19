// Scène de l'appel (colonne gauche) : nom de l'assistant, statut, avatar, bouton
// Appeler/Raccrocher, demi-duplex, modèles utilisés
import { useEffect, useRef } from "react";

import { avatar, engine } from "@/app/runtime";
import { modelLabel, projectLabel } from "@/lib/labels";
import { useAppStore } from "@/state/hooks";
import { currentVoice } from "@/state/slices/profile";
import { store } from "@/state/store";

import "./call.css";

function AvatarCanvas() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => (host.current ? avatar.mount(host.current) : undefined), []);
  // Conteneur transparent pour la grille : le canvas .orb en est l'élément
  return <div ref={host} className="contents" />;
}

function ModelInfo() {
  const config = useAppStore((state) => state.config);
  const settings = useAppStore((state) => state.settings);
  const name = useAppStore((state) => currentVoice(state)?.name ?? "Antares");
  const quantization = config.ttsQuantization
    ? `, ${String(config.ttsQuantization)}`
    : "";
  const rows: [string, string][] = [
    ["LLM", modelLabel(settings?.model)],
    ["Projet", projectLabel(settings?.project)],
    ["Voix", `${name} (${String(config.tts ?? "")} clonée${quantization})`],
    ["Transcription", String(config.stt ?? "")],
  ];
  if (!settings)
    return <footer className="stage__info" aria-label="Modèles utilisés" />;
  return (
    <footer className="stage__info" aria-label="Modèles utilisés">
      {rows.map(([label, value]) => (
        <div key={label}>
          <strong>{label} </strong>
          {value}
        </div>
      ))}
    </footer>
  );
}

export function CallStage() {
  const callState = useAppStore((state) => state.callState);
  const status = useAppStore((state) => state.status);
  const halfDuplex = useAppStore((state) => state.halfDuplex);
  const name = useAppStore((state) => currentVoice(state)?.name ?? "Antares");
  const speaker = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    document.title = `${name} · Antares`;
  }, [name]);

  useEffect(() => {
    engine.attachSpeaker(speaker.current);
    return () => engine.attachSpeaker(null);
  }, []);

  return (
    <>
      <header className="stage__identity">
        <h1 className="stage__name">{name}</h1>
        <p
          className="stage__status"
          role="status"
          aria-live="polite"
          data-testid="status"
        >
          {status}
        </p>
      </header>
      <AvatarCanvas />
      <div className="stage__controls">
        <button
          type="button"
          className="call-button"
          data-testid="call"
          disabled={callState === "connecting"}
          onClick={() => engine.toggle()}
        >
          {callState === "idle" || callState === "connecting"
            ? "Appeler"
            : "Raccrocher"}
        </button>
        <label className="stage__option">
          <input
            type="checkbox"
            checked={halfDuplex}
            onChange={(event) =>
              store.getState().setHalfDuplex(event.target.checked)
            }
          />
          <span>
            Couper mon micro pendant la réponse (sans casque, si l'écho
            interrompt la réponse)
          </span>
        </label>
      </div>
      <ModelInfo />
      <audio ref={speaker} autoPlay hidden data-testid="speaker" />
    </>
  );
}
