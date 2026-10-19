// Saisie écrite : Entrée envoie, Maj+Entrée va à la ligne ; « Ajouter au contexte »
// garde le texte sans demander de réponse ; trombone pour joindre des documents
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { engine } from "@/app/runtime";
import { ACCEPT, AttachmentList, uploadAll } from "@/features/attachments";
import { useAppStore } from "@/state/hooks";

export function Composer({
  textRef,
}: {
  textRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [text, setText] = useState("");
  const writing = useAppStore((state) => state.writing);
  const fileInput = useRef<HTMLInputElement>(null);

  function send(respond: boolean) {
    if (engine.sendText(text, respond)) setText("");
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    send(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      send(true);
    }
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <AttachmentList />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept={ACCEPT}
        data-testid="attach-input"
        onChange={(event) => {
          void uploadAll([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
      <textarea
        ref={textRef}
        className="composer__text"
        rows={2}
        placeholder="Écrire un message (Entrée : envoyer, Maj+Entrée : nouvelle ligne)"
        aria-label="Message écrit"
        data-testid="composer-text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="composer__actions">
        <button
          type="button"
          className="button-ghost attach-button"
          title="Joindre des documents (PDF, Word, texte, images) — ou glissez-les ici"
          aria-label="Joindre des documents"
          onClick={() => fileInput.current?.click()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M16.5 6.5v10a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v10.5a1.5 1.5 0 0 1-3 0V6.5H9v9a3 3 0 0 0 6 0V5a4.5 4.5 0 0 0-9 0v11.5a6 6 0 0 0 12 0v-10h-1.5Z" />
          </svg>
        </button>
        <button
          type="button"
          className="button-ghost"
          title="Ajoute le texte à la conversation sans demander de réponse"
          disabled={writing}
          onClick={() => send(false)}
        >
          Ajouter au contexte
        </button>
        <button type="submit" className="button-primary" disabled={writing}>
          Envoyer
        </button>
      </div>
    </form>
  );
}
