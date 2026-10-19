// Étiquettes des documents joints, avec la taille estimée et le retrait
import { useStore } from "zustand";

import {
  attachments,
  KIND_LABELS,
  removeDocument,
  tokenSize,
} from "./attachments";

export function AttachmentList() {
  const { documents, pending } = useStore(attachments);
  const empty = !documents.length && !pending.length;
  return (
    <ul className="attachments" hidden={empty}>
      {documents.map((doc) => (
        <li
          key={doc.id}
          className="attachment"
          data-id={doc.id}
          data-testid="attachment"
        >
          <span className="attachment__kind">
            {KIND_LABELS[doc.kind] ?? doc.kind}
          </span>
          <span className="attachment__name">{doc.name}</span>
          <span className="attachment__size">{tokenSize(doc.tokens)}</span>
          {!doc.voice && (
            <span
              className="attachment__warn"
              title="Trop long pour la conversation orale : utilisé pour les réponses écrites"
            >
              écrit seulement
            </span>
          )}
          <button
            type="button"
            className="attachment__remove"
            title={`Retirer ${doc.name}`}
            aria-label={`Retirer ${doc.name}`}
            onClick={() => void removeDocument(doc.id)}
          >
            ×
          </button>
        </li>
      ))}
      {pending.map((item) => (
        <li
          key={`pending-${item.key}`}
          className="attachment attachment--pending"
        >
          <span className="attachment__name">{item.name}</span>
          <span className="attachment__size">lecture…</span>
        </li>
      ))}
    </ul>
  );
}
