// Barre de filtres des articles (collante sous l'en-tête) : recherche, catégories,
// source, langue, articles aimés. Filtres en mémoire seulement. Sur petit écran, tout
// sauf la recherche se replie derrière le bouton « Filtres ».
import { Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import type { VeilleCategory, VeilleItem, VeilleLang } from "@/types/api";

import {
  activeFilters,
  type ArticleFilters,
  categoriesOf,
  categoryColor,
  NO_FILTERS,
  sourcesOf,
} from "./veille";

const LANGS: { value: VeilleLang; label: string }[] = [
  { value: "", label: "Toutes" },
  { value: "fr", label: "Français" },
  { value: "en", label: "Anglais" },
];

export function VeilleFilters({
  items,
  categories,
  filters,
  onChange,
}: {
  items: readonly VeilleItem[];
  categories: readonly VeilleCategory[];
  filters: ArticleFilters;
  onChange: (next: ArticleFilters) => void;
}) {
  const [open, setOpen] = useState(false);
  const present = categoriesOf(items, categories);
  const sources = sourcesOf(items);
  const active = activeFilters(filters);
  const set = (changes: Partial<ArticleFilters>) =>
    onChange({ ...filters, ...changes });

  function toggleCategory(slug: string) {
    const selected = filters.categories.includes(slug)
      ? filters.categories.filter((s) => s !== slug)
      : [...filters.categories, slug];
    set({ categories: selected });
  }

  return (
    <div className="veille-filters" data-testid="veille-filters">
      <div className="veille-filters__inner">
        <div className="veille-filters__top">
          <div className="veille-search">
            <label htmlFor="veille-search" className="sr-only">
              Rechercher dans les articles
            </label>
            <Search className="veille-search__icon" aria-hidden="true" />
            <input
              id="veille-search"
              type="search"
              className="veille-search__input"
              placeholder="Rechercher un article, une source…"
              autoComplete="off"
              value={filters.query}
              onChange={(event) => set({ query: event.target.value })}
            />
          </div>
          <button
            type="button"
            className="veille-pill veille-filters__toggle"
            aria-expanded={open}
            aria-controls="veille-filters-more"
            onClick={() => setOpen(!open)}
          >
            <SlidersHorizontal aria-hidden="true" />
            Filtres
            {active > 0 && (
              <span className="veille-filters__count-badge">{active}</span>
            )}
          </button>
        </div>
        <div
          id="veille-filters-more"
          className="veille-filters__more"
          data-open={open ? "true" : "false"}
        >
          <div className="veille-chips" role="group" aria-label="Catégories">
            <button
              type="button"
              className="veille-chip"
              aria-pressed={filters.categories.length === 0}
              onClick={() => set({ categories: [] })}
            >
              Toutes
            </button>
            {present.map((category) => (
              <button
                key={category.slug || "autre"}
                type="button"
                className="veille-chip"
                data-cat={categoryColor(category.slug)}
                aria-pressed={filters.categories.includes(category.slug)}
                onClick={() => toggleCategory(category.slug)}
              >
                <span className="veille-chip__dot" aria-hidden="true" />
                {category.label}
                <span className="veille-chip__count">{category.count}</span>
              </button>
            ))}
          </div>
          <div className="veille-filters__controls">
            <label className="veille-field">
              <span className="veille-field__label">Source</span>
              <select
                className="veille-select"
                value={filters.source}
                onChange={(event) => set({ source: event.target.value })}
              >
                <option value="">Toutes les sources</option>
                {sources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
            <div className="veille-field">
              <span className="veille-field__label" id="veille-lang-label">
                Langue
              </span>
              <div
                className="veille-segmented"
                role="group"
                aria-labelledby="veille-lang-label"
              >
                {LANGS.map((option) => (
                  <button
                    key={option.value || "all"}
                    type="button"
                    aria-pressed={filters.lang === option.value}
                    onClick={() => set({ lang: option.value })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="veille-check">
              <input
                type="checkbox"
                checked={filters.likedOnly}
                onChange={(event) => set({ likedOnly: event.target.checked })}
              />
              Aimés seulement
            </label>
            {active > 0 && (
              <button
                type="button"
                className="veille-link-button"
                onClick={() => onChange(NO_FILTERS)}
              >
                Effacer les filtres
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
