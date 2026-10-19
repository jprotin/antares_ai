// Bloc « Sources (web) » sous une réponse, puis mots-clés demandés au modèle local
// (port de showWebSources et showTags, web.js)
import { useEffect, useState } from "react";

import { sendJson } from "@/lib/api";
import type { TurnWeb } from "@/types/api";

import { sourcePrefix } from "./sourcePrefix";
import { Tags } from "./Tags";

type Props = { lineId: string; web: TurnWeb; answer: string };

export function WebSources({ lineId, web, answer }: Props) {
  const [tags, setTags] = useState<string[]>([]);
  const prefix = sourcePrefix(lineId);

  useEffect(() => {
    let cancelled = false;
    sendJson<{ tags: string[] }>("api/web/tags", "POST", {
      question: web.query,
      answer,
    })
      .then(({ tags }) => {
        if (!cancelled) setTags(tags);
      })
      .catch((error) => console.warn("Mots-clés indisponibles", error));
    return () => {
      cancelled = true;
    };
    // Une demande par bloc de sources, une fois la réponse affichée
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId]);

  return (
    <>
      <section className="web-sources">
        <div className="web-sources__head">
          <strong>Sources</strong>
          <span className="badge badge--cloud">web</span>
          <span className="web-sources__query">« {web.query} »</span>
        </div>
        <ol className="web-sources__list">
          {(web.sources ?? []).map((source) => (
            <li
              key={source.n}
              className="web-source"
              id={`${prefix}-${source.n}`}
            >
              <span className="web-source__n">{source.n}</span>
              <a
                className="web-source__title"
                href={/^https?:\/\//i.test(source.url) ? source.url : undefined}
                target="_blank"
                rel="noopener noreferrer"
              >
                {source.title}
              </a>
              <span className="web-source__domain">{source.domain}</span>
              {source.snippet && (
                <p className="web-source__snippet">{source.snippet}</p>
              )}
            </li>
          ))}
        </ol>
      </section>
      {tags.length > 0 && <Tags tags={tags} />}
    </>
  );
}
