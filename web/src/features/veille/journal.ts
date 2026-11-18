// Journal de la veille : l'avatar présente les sujets du jour, à la voix, et demande
// l'avis de l'utilisateur. Le routeur tient le conducteur (/api/veille/journal, cf.
// router/veille_journal.py) ; l'interface lance l'appel et y glisse un message caché
// (marqueur) pour que l'avatar prenne la parole le premier.
import { engine } from "@/app/runtime";
import { deleteResource, getJson, sendJson } from "@/lib/api";

export const JOURNAL_MARKER = "[Journal de la veille]";

export type JournalState = {
  active: boolean;
  stage?: string;
  index?: number;
  total?: number;
  current_id?: string | null;
  topics?: { id: string; title: string }[];
};

export function journalState(): Promise<JournalState> {
  return getJson<JournalState>("api/veille/journal");
}

// Message invisible dans la conversation : le routeur le remplace par l'étape du journal
function cue(text: string) {
  engine.send({
    type: "conversation.item.create",
    item: {
      id: `msg_journal${Date.now()}`,
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: `${JOURNAL_MARKER} ${text}` }],
    },
  });
  engine.send({ type: "response.create" });
}

// Coupe la parole en cours (sujet suivant, arrêt)
function silence() {
  if (!engine.inCall()) return;
  engine.send({ type: "response.cancel" });
  engine.stopPlayback();
}

export async function startJournal(): Promise<JournalState> {
  const started = await sendJson<JournalState>("api/veille/journal", "PUT");
  if (engine.inCall()) {
    silence();
    cue("Lance le journal.");
  } else {
    await engine.start({
      replay: false,
      onOpen: () => cue("Lance le journal."),
    });
  }
  return started;
}

export function nextTopic() {
  silence();
  cue("Sujet suivant.");
}

// Arrêt : l'avatar se tait, l'appel continue (conversation libre sur la veille)
export async function stopJournal() {
  silence();
  await deleteResource("api/veille/journal");
}
