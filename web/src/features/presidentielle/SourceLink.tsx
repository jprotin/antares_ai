// Source d'un texte : niveau (officiel État, document du candidat, vote réel), titre en
// lien (https seulement, nouvel onglet), date de publication ou de consultation, page
import { Badge } from "@/components/ui/badge";

import { formatDate, NIVEAU_LABEL, safeUrl } from "./labels";
import type { Source } from "./types";

export function SourceLink({
  source,
  page,
}: {
  source: Source | null;
  page?: number | null;
}) {
  if (!source)
    return (
      <span className="presidentielle-source" data-source="absente">
        Source non renseignée
      </span>
    );
  const href = safeUrl(source.url);
  const dated = source.publie_le
    ? `publié le ${formatDate(source.publie_le)}`
    : `consulté le ${formatDate(source.consulte_le)}`;
  return (
    <span
      className="presidentielle-source"
      data-source={source.id}
      data-niveau={source.niveau}
    >
      <Badge variant="secondary">{NIVEAU_LABEL[source.niveau]}</Badge>
      {href ? (
        <a
          className="presidentielle-source__lien"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {source.titre}
        </a>
      ) : (
        <span data-sans-lien>{source.titre}</span>
      )}
      <span>
        {dated}
        {page ? `, page ${page}` : ""}
      </span>
    </span>
  );
}
