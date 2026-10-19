// Lecture du flux SSE de /api/chat (logique de writtenReply, app.js), à l'identique :
// seules les lignes « data: {…} » complètes comptent ; un dernier fragment sans saut de
// ligne est ignoré et un JSON invalide lève une exception (réponse en erreur).

type Reader = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
};

type Chunk = { choices?: { delta?: { content?: string } }[] };

export async function readChatStream(
  reader: Reader,
  onDelta: (answer: string, delta: string) => void = () => {},
): Promise<string> {
  const decoder = new TextDecoder();
  let answer = "";
  let pending = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: {")) continue;
      const delta = (JSON.parse(line.slice(6)) as Chunk).choices?.[0]?.delta
        ?.content;
      if (!delta) continue;
      answer += delta;
      onDelta(answer, delta);
    }
  }
  return answer;
}
