// Une ligne de la conversation (port de subtitleLine / writeSubtitle / annotate, app.js)
import { memo } from "react";

import type { Line } from "@/state/slices/lines";

import { MarkdownView } from "./MarkdownView";
import { sourcePrefix } from "./sourcePrefix";
import { WebSources } from "./WebSources";

// Réponse orale avec sources web : renvois [n] liés, comme linkCitations (web.js)
function PlainText({
  text,
  prefix,
  count,
}: {
  text: string;
  prefix: string;
  count: number;
}) {
  if (!count) return <span className="line__text">{text}</span>;
  const parts = text.split(/\[(\d{1,2})\]/);
  return (
    <span className="line__text">
      {parts.map((part, index) => {
        if (index % 2 === 0) return part;
        const n = Number(part);
        if (n < 1 || n > count) return `[${part}]`;
        return (
          <a key={index} className="citation" href={`#${prefix}-${n}`}>
            {n}
          </a>
        );
      })}
    </span>
  );
}

export const MessageLine = memo(function MessageLine({ line }: { line: Line }) {
  if (line.role === "system") {
    return (
      <p className={`line line--system${line.error ? " line--error" : ""}`}>
        {line.text}
      </p>
    );
  }
  const classes = [
    "line",
    `line--${line.role}`,
    line.partial && "line--partial",
    line.rich && "line--rich",
    line.error && "line--error",
  ]
    .filter(Boolean)
    .join(" ");
  const sources = line.web?.sources?.length ?? 0;
  return (
    <div
      className={classes}
      data-item={line.id}
      data-testid={`line-${line.role}`}
    >
      <span className="line__who">{line.who}</span>
      {line.rich ? (
        <MarkdownView
          className="line__text"
          text={line.text}
          streaming={line.partial}
          sourcePrefix={sourcePrefix(line.id)}
          sourceCount={sources}
        />
      ) : (
        <PlainText
          text={line.text}
          prefix={sourcePrefix(line.id)}
          count={sources}
        />
      )}
      {line.code && (
        <MarkdownView
          as="div"
          className="line__code line--rich"
          text={line.code}
        />
      )}
      {line.refs && (
        <div className="line__refs">
          <strong>Références</strong>
          <ul>
            {line.refs.map((ref) => (
              <li key={ref}>{ref}</li>
            ))}
          </ul>
        </div>
      )}
      {line.web && sources > 0 && (
        <WebSources lineId={line.id} web={line.web} answer={line.text} />
      )}
      {line.meta.length > 0 && (
        <span className="line__meta">{line.meta.join(" · ")}</span>
      )}
    </div>
  );
});
