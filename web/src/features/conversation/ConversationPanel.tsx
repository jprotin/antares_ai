// Colonne de droite : conversation écrite et orale, saisie, documents joints
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";

import { engine } from "@/app/runtime";
import { clearDocuments, uploadAll } from "@/features/attachments";
import { useAppStore } from "@/state/hooks";
import { store } from "@/state/store";

import { copyCode } from "./codeCopy";
import { Composer } from "./Composer";
import { MessageLine } from "./MessageLine";
import "./conversation.css";

const hasFiles = (event: DragEvent) =>
  Boolean(event.dataTransfer?.types.includes("Files"));

export function ConversationPanel() {
  const lines = useAppStore((state) => state.lines);
  const inCall = useAppStore((state) => state.callState !== "idle");
  const list = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const [dropDepth, setDropDepth] = useState(0);

  // Défilement en bas à chaque nouvelle ligne ou mise à jour, avant l'image suivante :
  // pas de mise en page forcée pendant le rendu d'une longue réponse
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const element = list.current;
      if (element) element.scrollTop = element.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [lines]);

  // Copier et mots-clés : délégation (les blocs sont recréés à chaque rendu)
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const copy = target.closest<HTMLElement>(".code__copy");
      if (copy) {
        void copyCode(copy);
        return;
      }
      const tag = target.closest<HTMLElement>(".tag");
      if (tag?.dataset.tag && !store.getState().writing)
        engine.sendText(`Cherche sur internet : ${tag.dataset.tag}`, true);
    };
    element.addEventListener("click", onClick);
    return () => element.removeEventListener("click", onClick);
  }, []);

  function newConversation() {
    const state = store.getState();
    state.clearMessages();
    state.clearLines();
    void clearDocuments();
    text.current?.focus();
  }

  return (
    <section
      className={`conversation${dropDepth ? " is-dropping" : ""}`}
      aria-label="Conversation écrite"
      onDragEnter={(event) => {
        if (hasFiles(event)) setDropDepth((depth) => depth + 1);
      }}
      onDragLeave={() => setDropDepth((depth) => Math.max(0, depth - 1))}
      onDragOver={(event) => {
        if (hasFiles(event)) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropDepth(0);
        void uploadAll([...(event.dataTransfer?.files ?? [])]);
      }}
    >
      <header className="conversation__header">
        <h2>Conversation</h2>
        <button
          type="button"
          className="link-button"
          title="Efface la conversation (écrite et orale) pour repartir de zéro"
          disabled={inCall}
          onClick={newConversation}
        >
          Nouvelle conversation
        </button>
      </header>
      <div
        ref={list}
        className="conversation__lines"
        aria-live="polite"
        data-testid="subtitles"
      >
        {lines.length === 0 ? (
          <p className="conversation__empty">
            La conversation s'affichera ici en direct.
          </p>
        ) : (
          lines.map((line) => <MessageLine key={line.id} line={line} />)
        )}
      </div>
      <Composer textRef={text} />
    </section>
  );
}
