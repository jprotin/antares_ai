// Fenêtre « Sources » de la veille : ajout d'un site, d'un flux ou d'un sujet (recherche
// Google News) après une lecture d'essai, liste des sources ajoutées (catégorie,
// suppression en deux clics), interrupteurs des sources fournies par tasks.yaml et étoile
// « source privilégiée » (3 places garanties) sur chacune. Prises en compte au passage
// suivant de la veille.
import { Check, FlaskConical, Plus, Search, Star, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  VeilleCustomSource,
  VeilleSourceInput,
  VeilleSourceProbe,
  VeilleSources,
} from "@/types/api";

import {
  addSource,
  deleteSource,
  loadSources,
  setBuiltinEnabled,
  setFavorite,
  testSource,
  updateSource,
} from "./api";
import {
  EMPTY_SOURCE,
  categoryLabel,
  filterSources,
  probeSummary,
  sourceHost,
  sourceReady,
} from "./veille";

type ProbeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; probe: VeilleSourceProbe }
  | { status: "error"; message: string };

const message = (error: unknown) =>
  error instanceof Error ? error.message : "erreur inconnue";

function StarButton({
  name,
  favorite,
  onClick,
}: {
  name: string;
  favorite: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="veille-vote veille-star"
      aria-pressed={favorite}
      aria-label={`Privilégier ${name}`}
      title={favorite ? "Source privilégiée" : "Privilégier cette source"}
      onClick={onClick}
    >
      <Star aria-hidden="true" />
    </button>
  );
}

export function SourcesDialog({ onClose }: { onClose: () => void }) {
  const ids = useId();
  const [data, setData] = useState<VeilleSources | null>(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<VeilleSourceInput>(EMPTY_SOURCE);
  const [probe, setProbe] = useState<ProbeState>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    let alive = true;
    loadSources()
      .then((sources) => alive && setData(sources))
      .catch((error: unknown) => alive && setLoadError(message(error)));
    return () => {
      alive = false;
    };
  }, []);

  function edit(changes: Partial<VeilleSourceInput>) {
    setForm((current) => ({ ...current, ...changes }));
    setProbe({ status: "idle" });
  }

  async function onTest() {
    setProbe({ status: "loading" });
    try {
      setProbe({ status: "ok", probe: await testSource(form) });
    } catch (error) {
      setProbe({ status: "error", message: message(error) });
    }
  }

  async function onAdd() {
    setSaving(true);
    try {
      const saved = await addSource(form);
      setData((current) =>
        current ? { ...current, custom: [...current.custom, saved] } : current,
      );
      setForm({ ...EMPTY_SOURCE, kind: form.kind, lang: form.lang });
      setProbe({ status: "idle" });
      setAnnounce(`Source « ${saved.name} » ajoutée`);
    } catch (error) {
      setProbe({ status: "error", message: message(error) });
    } finally {
      setSaving(false);
    }
  }

  async function onCategory(source: VeilleCustomSource, category: string) {
    try {
      const saved = await updateSource(source.id, { category });
      setData((current) =>
        current
          ? {
              ...current,
              custom: current.custom.map((s) =>
                s.id === saved.id ? saved : s,
              ),
            }
          : current,
      );
      setAnnounce(`Catégorie de « ${saved.name} » modifiée`);
    } catch (error) {
      setAnnounce(`Modification impossible : ${message(error)}`);
    }
  }

  async function onDelete(source: VeilleCustomSource) {
    if (confirm !== source.id) {
      setConfirm(source.id);
      return;
    }
    setConfirm(null);
    try {
      await deleteSource(source.id);
      setData((current) =>
        current
          ? {
              ...current,
              custom: current.custom.filter((s) => s.id !== source.id),
            }
          : current,
      );
      setAnnounce(`Source « ${source.name} » supprimée`);
    } catch (error) {
      setAnnounce(`Suppression impossible : ${message(error)}`);
    }
  }

  async function onToggle(name: string, enabled: boolean) {
    const flip = (value: boolean) =>
      setData((current) =>
        current
          ? {
              ...current,
              builtin: current.builtin.map((s) =>
                s.name === name ? { ...s, enabled: value } : s,
              ),
            }
          : current,
      );
    flip(enabled);
    try {
      await setBuiltinEnabled(name, enabled);
      setAnnounce(`« ${name} » ${enabled ? "réactivée" : "désactivée"}`);
    } catch (error) {
      flip(!enabled);
      setAnnounce(`Changement impossible : ${message(error)}`);
    }
  }

  async function onFavorite(name: string, favorite: boolean) {
    const count = data
      ? [...data.builtin, ...data.custom].filter((s) => s.favorite).length
      : 0;
    if (data && favorite && count >= data.max_favorites) {
      setAnnounce(`${data.max_favorites} sources privilégiées au plus`);
      return;
    }
    const flip = (value: boolean) =>
      setData((current) =>
        current
          ? {
              ...current,
              builtin: current.builtin.map((s) =>
                s.name === name ? { ...s, favorite: value } : s,
              ),
              custom: current.custom.map((s) =>
                s.name === name ? { ...s, favorite: value } : s,
              ),
            }
          : current,
      );
    flip(favorite);
    try {
      await setFavorite(name, favorite);
      setAnnounce(
        favorite
          ? `« ${name} » privilégiée : 3 places garanties`
          : `« ${name} » n'est plus privilégiée`,
      );
    } catch (error) {
      flip(!favorite);
      setAnnounce(`Changement impossible : ${message(error)}`);
    }
  }

  const categories = data?.categories ?? [];
  const full = data ? data.custom.length >= data.max_custom : false;
  const ready = sourceReady(form) && !full;
  const shownBuiltin = data ? filterSources(data.builtin, query) : [];
  const active = data?.builtin.filter((s) => s.enabled).length ?? 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="veille-prompt veille-sources flex max-h-[min(92dvh,56rem)] flex-col gap-0 p-0 sm:max-w-3xl motion-reduce:animate-none"
        data-testid="veille-sources"
      >
        <header className="veille-prompt__header">
          <p className="veille-prompt__kicker">Veille</p>
          <DialogTitle className="veille-prompt__title text-lg leading-snug font-bold">
            Sources
          </DialogTitle>
          <DialogDescription className="veille-prompt__desc">
            Ajoute un site, un flux ou un sujet, et coupe les sources fournies
            qui ne t'intéressent pas. Pris en compte au prochain passage.
          </DialogDescription>
        </header>

        <div className="veille-sources__body">
          {loadError && (
            <p className="veille-prompt__error" role="alert">
              Sources indisponibles : {loadError}
            </p>
          )}
          {!data && !loadError && (
            <div className="veille-prompt__loading" role="status">
              <span className="veille-spinner" aria-hidden="true" />
              <p>Chargement des sources…</p>
            </div>
          )}

          {data && (
            <>
              <section
                className="veille-sources__section"
                aria-labelledby={`${ids}-add`}
              >
                <h3 id={`${ids}-add`} className="veille-sources__title">
                  Ajouter une source
                </h3>
                <div
                  className="veille-segmented"
                  role="group"
                  aria-label="Type de source"
                >
                  <button
                    type="button"
                    aria-pressed={form.kind === "feed"}
                    onClick={() => edit({ kind: "feed" })}
                  >
                    Site ou flux
                  </button>
                  <button
                    type="button"
                    aria-pressed={form.kind === "search"}
                    onClick={() => edit({ kind: "search" })}
                  >
                    Sujet
                  </button>
                </div>

                {form.kind === "feed" ? (
                  <label className="veille-sources__field">
                    <span className="veille-field__label">
                      Adresse du site ou du flux RSS
                    </span>
                    <input
                      className="veille-sources__input"
                      type="url"
                      inputMode="url"
                      placeholder="Adresse en https"
                      autoComplete="off"
                      value={form.url}
                      onChange={(event) => edit({ url: event.target.value })}
                    />
                  </label>
                ) : (
                  <label className="veille-sources__field">
                    <span className="veille-field__label">
                      Sujet (recherche Google News, dernières 24 h)
                    </span>
                    <input
                      className="veille-sources__input"
                      type="text"
                      placeholder="Raspberry Pi, Rust, Kubernetes…"
                      autoComplete="off"
                      maxLength={120}
                      value={form.query}
                      onChange={(event) => edit({ query: event.target.value })}
                    />
                  </label>
                )}

                <div className="veille-sources__grid">
                  <label className="veille-sources__field">
                    <span className="veille-field__label">
                      Nom (facultatif)
                    </span>
                    <input
                      className="veille-sources__input"
                      type="text"
                      maxLength={60}
                      autoComplete="off"
                      value={form.name}
                      onChange={(event) => edit({ name: event.target.value })}
                    />
                  </label>
                  <label className="veille-sources__field">
                    <span className="veille-field__label">Catégorie</span>
                    <select
                      className="veille-select"
                      aria-label="Catégorie de la nouvelle source"
                      value={form.category}
                      onChange={(event) =>
                        edit({ category: event.target.value })
                      }
                    >
                      <option value="">Automatique</option>
                      {categories.map((category) => (
                        <option key={category.slug} value={category.slug}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="veille-sources__field">
                    <span className="veille-field__label">Langue</span>
                    <select
                      className="veille-select"
                      aria-label="Langue de la nouvelle source"
                      value={form.lang}
                      onChange={(event) =>
                        edit({ lang: event.target.value as "fr" | "en" })
                      }
                    >
                      <option value="fr">Français</option>
                      <option value="en">Anglais</option>
                    </select>
                  </label>
                </div>
                <label className="veille-check">
                  <input
                    type="checkbox"
                    checked={form.filter_keywords}
                    onChange={(event) =>
                      edit({ filter_keywords: event.target.checked })
                    }
                  />
                  Garder seulement les titres liés à une catégorie (site
                  généraliste)
                </label>

                <div className="veille-sources__actions">
                  <button
                    type="button"
                    className="veille-pill"
                    disabled={!ready || probe.status === "loading"}
                    onClick={() => void onTest()}
                  >
                    <FlaskConical aria-hidden="true" />
                    Tester
                  </button>
                  <button
                    type="button"
                    className="veille-pill veille-pill--primary"
                    disabled={!ready || saving || probe.status === "loading"}
                    onClick={() => void onAdd()}
                  >
                    <Plus aria-hidden="true" />
                    {saving ? "Ajout…" : "Ajouter"}
                  </button>
                  {full && (
                    <p className="veille-muted">
                      {data.max_custom} sources au plus : supprimes-en une.
                    </p>
                  )}
                </div>

                <div
                  className="veille-sources__probe"
                  data-testid="veille-sources-probe"
                >
                  {probe.status === "loading" && (
                    <p role="status" className="veille-sources__probe-line">
                      <span className="veille-spinner" aria-hidden="true" />
                      Lecture de la source…
                    </p>
                  )}
                  {probe.status === "error" && (
                    <p role="alert" className="veille-sources__probe-error">
                      {probe.message}
                    </p>
                  )}
                  {probe.status === "ok" && (
                    <div className="veille-sources__probe-ok">
                      <p className="veille-sources__probe-line">
                        <Check aria-hidden="true" />
                        <strong>{probe.probe.name}</strong> :{" "}
                        {probeSummary(probe.probe)}
                      </p>
                      <ul className="veille-sources__latest">
                        {probe.probe.latest.map((article) => (
                          <li key={`${article.published_at}${article.title}`}>
                            {article.title}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </section>

              <section
                className="veille-sources__section"
                aria-labelledby={`${ids}-mine`}
              >
                <h3 id={`${ids}-mine`} className="veille-sources__title">
                  Mes sources{" "}
                  <span className="veille-section__count">
                    {data.custom.length}/{data.max_custom}
                  </span>
                </h3>
                {data.custom.length === 0 ? (
                  <p className="veille-muted">Aucune source ajoutée.</p>
                ) : (
                  <ul
                    className="veille-sources__list"
                    data-testid="veille-sources-custom"
                  >
                    {data.custom.map((source) => (
                      <li key={source.id} className="veille-sources__row">
                        <div className="veille-sources__info">
                          <span className="veille-sources__name">
                            {source.name}
                          </span>
                          <span className="veille-sources__meta">
                            {source.kind === "search"
                              ? `Sujet : ${source.query}`
                              : sourceHost(source.url)}
                            {" · "}
                            {source.lang.toUpperCase()}
                          </span>
                        </div>
                        <StarButton
                          name={source.name}
                          favorite={source.favorite}
                          onClick={() =>
                            void onFavorite(source.name, !source.favorite)
                          }
                        />
                        <select
                          className="veille-select"
                          aria-label={`Catégorie de ${source.name}`}
                          value={source.category}
                          onChange={(event) =>
                            void onCategory(source, event.target.value)
                          }
                        >
                          <option value="">Automatique</option>
                          {categories.map((category) => (
                            <option key={category.slug} value={category.slug}>
                              {category.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="veille-pill veille-pill--quiet"
                          data-confirm={
                            confirm === source.id ? "true" : undefined
                          }
                          aria-label={
                            confirm === source.id
                              ? `Confirmer la suppression de ${source.name}`
                              : `Supprimer ${source.name}`
                          }
                          onClick={() => void onDelete(source)}
                        >
                          <Trash2 aria-hidden="true" />
                          {confirm === source.id ? "Confirmer" : "Supprimer"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section
                className="veille-sources__section"
                aria-labelledby={`${ids}-builtin`}
              >
                <p className="veille-muted veille-sources__hint">
                  <Star aria-hidden="true" />
                  {` Étoile : source privilégiée, 3 places garanties à chaque passage (${data.max_favorites} au plus).`}
                </p>
                <h3 id={`${ids}-builtin`} className="veille-sources__title">
                  Sources fournies{" "}
                  <span className="veille-section__count">
                    {active} actives sur {data.builtin.length}
                  </span>
                </h3>
                <div className="veille-search">
                  <Search className="veille-search__icon" aria-hidden="true" />
                  <input
                    type="search"
                    className="veille-search__input"
                    aria-label="Rechercher une source fournie"
                    placeholder="Rechercher une source…"
                    autoComplete="off"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <ul
                  className="veille-sources__list"
                  data-testid="veille-sources-builtin"
                >
                  {shownBuiltin.map((source) => (
                    <li
                      key={source.name}
                      className="veille-sources__row"
                      data-enabled={source.enabled ? "true" : "false"}
                    >
                      <label className="veille-sources__toggle">
                        <input
                          type="checkbox"
                          checked={source.enabled}
                          onChange={(event) =>
                            void onToggle(source.name, event.target.checked)
                          }
                        />
                        <span className="veille-sources__info">
                          <span className="veille-sources__name">
                            {source.name}
                          </span>
                          <span className="veille-sources__meta">
                            {sourceHost(source.url)} ·{" "}
                            {categoryLabel(source.category, categories)}
                          </span>
                        </span>
                      </label>
                      <StarButton
                        name={source.name}
                        favorite={source.favorite}
                        onClick={() =>
                          void onFavorite(source.name, !source.favorite)
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>

        <footer className="veille-prompt__footer">
          <p className="sr-only" aria-live="polite">
            {announce}
          </p>
          <div className="veille-prompt__actions">
            <DialogClose asChild>
              <button type="button" className="veille-pill">
                Fermer
              </button>
            </DialogClose>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
