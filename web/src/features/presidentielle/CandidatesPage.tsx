// Sous-page Candidats : bandeaux, une carte identique par candidat dans l'ordre tiré au
// sort pour la visite, fiche détaillée au clic (« Retour à la liste », focus rendu au
// bouton du candidat ouvert), version de la base.
import { useEffect, useRef, useState } from "react";

import { CandidateCard } from "./CandidateCard";
import { CandidateDetail } from "./CandidateDetail";
import { LoadState } from "./LoadState";
import { BaseVersion, Notices } from "./Notices";
import { inVisitOrder } from "./state";
import { usePresidentielle } from "./usePresidentielle";
import "./presidentielle.css";

export function CandidatesPage() {
  const { status, error, base, meta, order } = usePresidentielle();
  const [selected, setSelected] = useState<string | null>(null);
  const lastOpened = useRef<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const candidats = base ? inVisitOrder(base.candidats, order) : [];
  const current = candidats.find((c) => c.id === selected);

  // Retour à la liste : focus sur le bouton du dernier candidat ouvert
  useEffect(() => {
    if (selected !== null || !lastOpened.current) return;
    const button = root.current?.querySelector<HTMLButtonElement>(
      `[data-candidat="${CSS.escape(lastOpened.current)}"] button[data-open]`,
    );
    button?.focus();
    button?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const open = (id: string) => {
    lastOpened.current = id;
    setSelected(id);
  };

  return (
    <section ref={root} aria-label="Candidats" className="presidentielle">
      <Notices base={base} meta={meta} />
      <LoadState status={status} error={error} loaded={base !== null} />
      {base && current ? (
        <CandidateDetail
          candidat={current}
          themes={base.themes}
          onBack={() => setSelected(null)}
        />
      ) : (
        base && (
          <>
            <h2 className="sr-only">Liste des candidats</h2>
            <ul
              className="presidentielle-grid"
              aria-label="Liste des candidats"
            >
              {candidats.map((candidat) => (
                <li key={candidat.id} className="flex">
                  <CandidateCard candidat={candidat} onOpen={open} />
                </li>
              ))}
            </ul>
          </>
        )
      )}
      {base && <BaseVersion version={base.version} />}
    </section>
  );
}
