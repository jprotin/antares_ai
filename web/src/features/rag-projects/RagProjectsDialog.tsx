// Projets du RAG intégré (port de ragprojects.js) : documentation déposée ici (Markdown,
// texte, code, PDF, Word), découpée et indexée par le service rag d'antares. Réservé au
// mode « RAG intégré » des Connexions : le RAG d'ai-to-boost s'alimente par ses outils.
import { Dialog } from "radix-ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { detailMessage, getJson } from "@/lib/api";
import { store } from "@/state/store";

import "@/styles/legacy-dialogs.css";

type Project = { id: string; chunks: number };
type RagDocument = {
  id: string;
  source: string;
  kind?: string;
  chunks: number;
};

// Même règle que le routeur (ragstore.project_id) : « Mon Appli » -> « mon-appli »
function projectId(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
}

async function failure(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as {
    detail?: unknown;
  };
  return detailMessage(body.detail) ?? `HTTP ${response.status}`;
}

async function upload(
  project: string,
  file: File,
): Promise<{ chunks: number }> {
  const response = await fetch(`api/rag/projects/${project}/documents`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  const body = (await response.json().catch(() => ({}))) as {
    detail?: string;
    chunks?: number;
  };
  if (!response.ok) {
    throw new Error(
      body.detail ??
        (response.status === 413
          ? `${file.name} : fichier trop volumineux (15 Mo au maximum)`
          : `${file.name} : HTTP ${response.status}`),
    );
  }
  return { chunks: body.chunks ?? 0 };
}

export function RagProjectsDialog() {
  const [integrated, setIntegrated] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selected, setSelected] = useState("");
  const [newName, setNewName] = useState("");
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [status, setStatusText] = useState<{ text: string; failed: boolean }>({
    text: "",
    failed: false,
  });
  const [adding, setAdding] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  // Projets ou documents changés : Réglages recharge sa liste à la fermeture

  const setStatus = (text: string, failed = false) =>
    setStatusText({ text, failed });

  const loadDocuments = useCallback(async (project: string) => {
    setDocuments(
      project
        ? await getJson<RagDocument[]>(`api/rag/projects/${project}/documents`)
        : [],
    );
  }, []);

  const loadProjects = useCallback(
    async (wanted?: string) => {
      const list = await getJson<Project[]>("api/projects");
      setProjects(list);
      const project =
        wanted && list.some((p) => p.id === wanted)
          ? wanted
          : (list[0]?.id ?? "");
      setSelected(project);
      await loadDocuments(project);
    },
    [loadDocuments],
  );

  useEffect(() => {
    let cancelled = false;
    getJson<{ services: { rag: { mode?: string } } }>("api/connections")
      .then(async ({ services }) => {
        if (cancelled) return;
        const isIntegrated = services.rag.mode === "integrated";
        setIntegrated(isIntegrated);
        if (!isIntegrated) {
          setError(
            "Disponible avec le RAG intégré : Connexions → RAG → « RAG intégré à antares ».",
          );
          return;
        }
        await loadProjects();
      })
      .catch((reason: Error) => !cancelled && setError(reason.message));
    return () => {
      cancelled = true;
    };
  }, [loadProjects]);

  const target = () => projectId(newName) || selected;

  async function addFiles(chosen: File[]) {
    const project = target();
    if (!chosen.length) return;
    setAdding(true);
    const failures: string[] = [];
    let chunks = 0;
    for (const [i, file] of chosen.entries()) {
      setStatus(`Indexation de ${file.name} (${i + 1}/${chosen.length})…`);
      try {
        chunks += (await upload(project, file)).chunks;
        // Réglages recharge sa liste de projets, même si la fenêtre est déjà fermée
        store.getState().catalogChanged();
      } catch (reason) {
        failures.push((reason as Error).message);
      }
    }
    setAdding(false);
    setNewName("");
    const done = chosen.length - failures.length;
    setStatus(
      `${done} document(s) indexé(s) dans ${project} (${chunks} extraits)` +
        (failures.length ? ` — échecs : ${failures.join(" ; ")}` : ""),
      failures.length > 0,
    );
    await loadProjects(project).catch((reason: Error) =>
      setStatus(reason.message, true),
    );
  }

  async function removeDocument(doc: RagDocument) {
    const project = selected;
    if (!window.confirm(`Retirer « ${doc.source} » de ${project} ?`)) return;
    const response = await fetch(
      `api/rag/projects/${project}/documents/${encodeURIComponent(doc.id)}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      setStatus(await failure(response), true);
      return;
    }
    store.getState().catalogChanged();
    await loadProjects(project);
  }

  async function dropProject() {
    const project = selected;
    if (
      !project ||
      !window.confirm(
        `Supprimer le projet « ${project} » et toute sa documentation indexée ?`,
      )
    )
      return;
    const response = await fetch(`api/rag/projects/${project}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setStatus(await failure(response), true);
      return;
    }
    store.getState().catalogChanged();
    setStatus(`Projet ${project} supprimé`);
    await loadProjects();
  }

  return (
    <div className="settings__form">
      <header className="settings__header dialog__header">
        <Dialog.Title asChild>
          <h2>Projets du RAG intégré</h2>
        </Dialog.Title>
        <p>
          Documentation de tes projets, consultée quand le projet est choisi
          dans les Réglages ou cité dans la question. Markdown, texte, code, PDF
          et Word ; redéposer un fichier du même nom le remplace.
        </p>
      </header>
      <p className="settings__error" id="rag-projects-error" role="alert">
        {error}
      </p>
      <div className="agent-form__row">
        <label className="fallback">
          Projet
          <select
            id="rag-project"
            disabled={!integrated}
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              loadDocuments(event.target.value).catch((reason: Error) =>
                setStatus(reason.message, true),
              );
            }}
          >
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {`${p.id} (${p.chunks} extraits)`}
              </option>
            ))}
            {projects && !projects.length && (
              <option value="">Aucun projet : en créer un</option>
            )}
          </select>
        </label>
        <label className="fallback">
          Ou nouveau projet
          <input
            id="rag-project-new"
            maxLength={64}
            placeholder="mon-appli"
            disabled={!integrated}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
        </label>
      </div>
      <input
        ref={files}
        type="file"
        id="rag-files"
        multiple
        hidden
        onChange={(event) => {
          const chosen = [...(event.target.files ?? [])];
          event.target.value = "";
          void addFiles(chosen);
        }}
      />
      <div className="settings__actions">
        <button
          type="button"
          className="button-ghost"
          id="rag-drop"
          disabled={!integrated || !selected}
          onClick={() => void dropProject()}
        >
          Supprimer le projet
        </button>
        <button
          type="button"
          className="button-primary"
          id="rag-add"
          disabled={!integrated || adding}
          onClick={() => {
            if (!target()) {
              setStatus(
                "Choisir un projet ou saisir le nom d'un nouveau projet",
                true,
              );
              return;
            }
            files.current?.click();
          }}
        >
          Ajouter des documents
        </button>
      </div>
      <p
        className={status.failed ? "settings__error" : "settings__hint"}
        id="rag-status"
        role="status"
      >
        {status.text}
      </p>
      <div className="agents__list" id="rag-documents">
        {documents.map((doc) => (
          <article key={doc.id} className="agent-card">
            <div className="agent-card__head">
              <span className="option__title">{doc.source}</span>
            </div>
            <p className="option__detail">
              {[doc.kind, `${doc.chunks} extrait(s)`]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="agent-card__actions">
              <button
                type="button"
                className="preview-button"
                onClick={() => void removeDocument(doc)}
              >
                Retirer
              </button>
            </div>
          </article>
        ))}
      </div>
      <footer className="settings__actions dialog__footer">
        <Dialog.Close asChild>
          <button
            type="button"
            className="button-primary"
            id="rag-projects-close"
          >
            Fermer
          </button>
        </Dialog.Close>
      </footer>
    </div>
  );
}
