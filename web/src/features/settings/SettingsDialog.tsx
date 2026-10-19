// Réglages (port de initSettingsDialog, settings.js) : avatar et sa voix (choix Mr / Miss
// Antares sur l'orbe seulement), modèle de langage, projet du RAG. Appliqués dès la
// phrase suivante, même en cours d'appel.
import { Dialog } from "radix-ui";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { avatar, engine } from "@/app/runtime";
import { voicesFor } from "@/app/bootstrap";
import type { AvatarKind } from "@/engines/avatar/AvatarHost";
import { getJson, sendJson } from "@/lib/api";
import { modelBadge, modelDetail, type ModelEntry } from "@/lib/labels";
import { useAppStore } from "@/state/hooks";
import { store } from "@/state/store";
import type { Settings, Voice } from "@/types/api";

import "./settings.css";

const AVATARS: { kind: AvatarKind; title: string; detail: string }[] = [
  {
    kind: "face3d",
    title: "Terminator",
    detail:
      "Rendu 3D réaliste (WebGL) : métal chromé, reflets, mâchoire articulée",
  },
  {
    kind: "visor",
    title: "Chappie",
    detail:
      "3D : yeux en LED qui changent d'expression, écran-bouche qui suit la voix, antennes",
  },
  {
    kind: "bender",
    title: "Bender",
    detail:
      "3D : bière et cigare en main, dents qui s'ouvrent en parlant, pupilles carrées",
  },
  {
    kind: "orb",
    title: "Orbe Antares",
    detail: "Nappes lumineuses animées selon l'état",
  },
];

type Project = { id: string; title?: string; detail?: string; chunks?: number };
type Loaded<T> =
  { status: "loading" } | { status: "ok"; items: T[] } | { status: "error" };

function Option({
  name,
  value,
  checked,
  onChange,
  title,
  detail,
  extra,
  trailing,
  disabled = false,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange(value: string): void;
  title: string;
  detail: string;
  extra?: string;
  trailing?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`option${disabled ? " option--disabled" : ""}`}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
      />
      <span>
        <span className="option__title">{title}</span>
        <span className="option__detail">{detail}</span>
        {extra !== undefined && (
          <span className="option__detail option__voice">{extra}</span>
        )}
      </span>
      <span>{trailing}</span>
    </label>
  );
}

export function SettingsDialog() {
  const settings = useAppStore((state) => state.settings);
  const voices = useAppStore((state) => state.voices);
  const [kind, setKind] = useState<AvatarKind>(avatar.kind);
  // Brouillons : sans changement de l'utilisateur, les valeurs viennent du profil (même
  // chargé après l'ouverture de la fenêtre)
  const [draftVoice, setVoice] = useState<string>();
  const [draftModel, setModel] = useState<string>();
  const [draftProject, setProject] = useState<string>();
  const orbChoices = voices.filter((v) => v.avatars?.includes("orb"));
  const voice =
    draftVoice ??
    (orbChoices.find((v) => v.id === settings?.voice) ?? orbChoices[0])?.id ??
    "";
  const model = draftModel ?? settings?.model ?? "";
  const project = draftProject ?? settings?.project ?? "";
  const [models, setModels] = useState<Loaded<ModelEntry>>({
    status: "loading",
  });
  const [projects, setProjects] = useState<Loaded<Project>>({
    status: "loading",
  });
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const preview = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    let cancelled = false;
    getJson<ModelEntry[]>("api/models")
      .then((items) => !cancelled && setModels({ status: "ok", items }))
      .catch((reason: Error) => {
        if (cancelled) return;
        setModels({ status: "error" });
        setError(`Liste des modèles indisponible : ${reason.message}`);
      });
    getJson<Project[]>("api/projects")
      .then((items) => !cancelled && setProjects({ status: "ok", items }))
      .catch(() => !cancelled && setProjects({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, []);

  function listen(choice: Voice) {
    const audio = preview.current;
    if (!audio) return;
    audio.src = `/voices/${choice.preview ?? choice.file}`;
    audio
      .play()
      .catch((reason: Error) =>
        setError(`Aperçu indisponible : ${reason.message}`),
      );
  }

  const listenButton = (choice: Voice) => (
    <button
      type="button"
      className="preview-button"
      title={`Écouter la voix ${choice.name}`}
      onClick={(event) => {
        event.preventDefault();
        listen(choice);
      }}
    >
      Écouter
    </button>
  );

  async function apply(event: FormEvent) {
    event.preventDefault();
    setApplying(true);
    setError("");
    // La voix suit l'avatar ; seul l'orbe laisse choisir
    const chosenVoice = kind === "orb" ? voice : voicesFor(kind)[0]?.id;
    try {
      const saved = await sendJson<Settings>("api/settings", "PUT", {
        voice: chosenVoice || undefined,
        model: model || null,
        project,
      });
      store.getState().setProfile({ settings: saved });
      if (kind !== avatar.kind) avatar.use(kind);
      store.getState().closeDialog();
      engine.sendVoiceSession();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setApplying(false);
    }
  }

  // Groupés par fournisseur, dans l'ordre de la liste (Ollama, API, Claude)
  const groups: { key: string; items: ModelEntry[] }[] = [];
  if (models.status === "ok")
    for (const entry of models.items) {
      const key = entry.providerName ?? "Claude (abonnement)";
      let group = groups.find((g) => g.key === key);
      if (!group) groups.push((group = { key, items: [] }));
      group.items.push(entry);
    }

  return (
    <form className="settings__form" onSubmit={apply}>
      <header className="settings__header dialog__header">
        <Dialog.Title asChild>
          <h2>Réglages</h2>
        </Dialog.Title>
        <p>Appliqués dès la phrase suivante, même en cours d'appel.</p>
      </header>

      <fieldset className="settings__group">
        <legend>Avatar</legend>
        <div className="settings__options">
          {AVATARS.map((item) => {
            const own = voices.filter((v) => v.avatars?.includes(item.kind));
            const single = own.length === 1 ? own[0] : undefined;
            return (
              <Option
                key={item.kind}
                name="avatar"
                value={item.kind}
                checked={kind === item.kind}
                onChange={(value) => setKind(value as AvatarKind)}
                title={item.title}
                detail={item.detail}
                extra={
                  own.length > 1
                    ? `Voix au choix : ${own.map((v) => v.name).join(" ou ")}`
                    : `Voix : ${own[0]?.name ?? "par défaut"}`
                }
                trailing={single ? listenButton(single) : null}
              />
            );
          })}
          <div
            className="option__voices"
            id="orb-voices"
            hidden={kind !== "orb"}
          >
            {orbChoices.map((choice) => (
              <Option
                key={choice.id}
                name="voice"
                value={choice.id}
                checked={voice === choice.id}
                onChange={setVoice}
                title={choice.name}
                detail={
                  choice.gender === "M" ? "Voix masculine" : "Voix féminine"
                }
                trailing={listenButton(choice)}
              />
            ))}
          </div>
        </div>
        <p className="settings__hint">
          Chaque avatar a sa voix ; Orbe Antares laisse choisir entre Mr et Miss
          Antares.
        </p>
      </fieldset>

      <fieldset className="settings__group">
        <legend>Modèle de langage</legend>
        <div className="settings__options">
          {models.status === "loading" && "Chargement de la liste…"}
          {groups.map(({ key, items }) => [
            <p key={`groupe-${key}`} className="option__group">
              {key}
            </p>,
            ...items.map((entry) => {
              const [variant, text] = modelBadge(entry);
              return (
                <Option
                  key={entry.name}
                  name="model"
                  value={entry.name}
                  checked={model === entry.name}
                  onChange={setModel}
                  title={entry.label ?? entry.name}
                  detail={modelDetail(entry)}
                  trailing={<span className={`badge ${variant}`}>{text}</span>}
                  // Modèles hors local : indisponibles hors ligne et pendant un partage
                  disabled={entry.available === false}
                />
              );
            }),
          ])}
        </div>
        <p className="settings__hint">
          Changer de modèle le charge en mémoire : la première réponse peut
          prendre quelques secondes de plus. Les modèles viennent des
          fournisseurs déclarés dans les Connexions.
        </p>
      </fieldset>

      <fieldset className="settings__group">
        <legend>Projet</legend>
        <div className="settings__options">
          {projects.status === "loading" && "Chargement de la liste…"}
          {projects.status === "error" && "RAG indisponible"}
          {projects.status === "ok" &&
            [
              {
                id: "",
                title: "Aucun",
                detail: "Sauf projet cité par son nom",
              },
              ...projects.items,
            ].map((item) => (
              <Option
                key={item.id || "aucun"}
                name="project"
                value={item.id}
                checked={project === item.id}
                onChange={setProject}
                title={item.title ?? item.id}
                detail={item.detail ?? `${item.chunks} extraits indexés`}
              />
            ))}
        </div>
        <p className="settings__hint">
          La documentation du projet choisi (RAG d'ai-to-boost ou RAG intégré,
          cf. Connexions) est ajoutée à chaque question. Sans projet choisi, un
          projet cité par son nom est consulté pour cette question.
        </p>
      </fieldset>

      <p className="settings__error" role="alert">
        {error}
      </p>

      <footer className="settings__actions dialog__footer">
        <Dialog.Close asChild>
          <button type="button" className="button-ghost">
            Annuler
          </button>
        </Dialog.Close>
        <button
          type="submit"
          className="button-primary"
          disabled={applying || !settings}
        >
          Appliquer
        </button>
      </footer>
      <audio ref={preview} hidden />
    </form>
  );
}
