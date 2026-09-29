"""Code à l'oral : les blocs de code sont affichés à l'écran, jamais lus par la voix.

Le LLM écrit le code dans un bloc Markdown (```langage … ```) et l'explique en phrases.
Sur le chemin de la voix, `FenceFilter` retire ces blocs du texte envoyé à la synthèse,
au fil du flux (un délimiteur peut arriver coupé entre deux morceaux), et les garde pour
que l'interface les affiche sous la réponse.
"""

import json
import re
from collections import OrderedDict
from collections.abc import AsyncIterator, Callable

FENCE = "```"
# Réponses vocales récentes : texte prononcé -> texte complet (avec le code)
MEMORY_SIZE = 64
_spoken_to_full: OrderedDict[str, str] = OrderedDict()


def _key(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def remember(spoken: str, full: str) -> None:
    """Retient la version complète d'une réponse dont le code a été retiré de la voix."""
    if spoken.strip() and full != spoken:
        _spoken_to_full[_key(spoken)] = full
        _spoken_to_full.move_to_end(_key(spoken))
        while len(_spoken_to_full) > MEMORY_SIZE:
            _spoken_to_full.popitem(last=False)


def restore(messages: list[dict]) -> list[dict]:
    """Remet le code dans les réponses de l'historique renvoyé par le moteur vocal.

    Le moteur ne connaît que le texte prononcé ; sans le code, le modèle imite ses
    réponses précédentes et cesse d'écrire des blocs (mesuré : 0/3 contre 3/3).
    """
    restored = []
    for message in messages:
        content = message.get("content")
        full = (
            _spoken_to_full.get(_key(content))
            if message.get("role") == "assistant" and isinstance(content, str)
            else None
        )
        restored.append({**message, "content": full} if full else message)
    return restored


class FenceFilter:
    def __init__(self) -> None:
        self.blocks: list[dict] = []
        self._pending = ""
        self._in_code = False
        self._header = False
        self._lang = ""
        self._code = ""

    @staticmethod
    def _split_tail(text: str) -> tuple[str, str]:
        """Sépare les accents graves finaux : peut-être le début d'un délimiteur."""
        tail = len(text) - len(text.rstrip("`"))
        tail = min(tail, len(FENCE) - 1)
        return (text[:-tail], text[-tail:]) if tail else (text, "")

    def _close(self) -> None:
        code = self._code.strip("\n")
        if code.strip():
            self.blocks.append({"lang": self._lang, "code": code})
        self._in_code, self._header, self._lang, self._code = False, False, "", ""

    def feed(self, text: str) -> str:
        """Ajoute un morceau du flux ; renvoie la partie à prononcer."""
        # Accents graves isolés (`ls`) : inutiles et parfois lus par la synthèse
        return self._feed(text).replace("`", "")

    def _feed(self, text: str) -> str:
        buffer, self._pending, spoken = self._pending + text, "", ""
        while buffer:
            if not self._in_code:
                index = buffer.find(FENCE)
                if index < 0:
                    kept, self._pending = self._split_tail(buffer)
                    return spoken + kept
                spoken += buffer[:index]
                buffer = buffer[index + len(FENCE) :]
                self._in_code, self._header = True, True
                continue
            if self._header:
                newline = buffer.find("\n")
                if newline < 0:
                    self._pending = buffer
                    return spoken
                self._lang = buffer[:newline].strip().lower()
                buffer = buffer[newline + 1 :]
                self._header = False
                continue
            index = buffer.find(FENCE)
            if index < 0:
                kept, self._pending = self._split_tail(buffer)
                self._code += kept
                return spoken
            self._code += buffer[:index]
            buffer = buffer[index + len(FENCE) :]
            self._close()
        return spoken

    def flush(self) -> str:
        """Fin du flux : un bloc non refermé est gardé tel quel, rien n'est prononcé."""
        rest, self._pending = self._pending, ""
        if self._in_code:
            self._code += rest if not self._header else ""
            self._close()
            return ""
        return rest.replace("`", "")


async def filter_sse(
    chunks: AsyncIterator[bytes], on_blocks: Callable[[list[dict]], None]
) -> AsyncIterator[bytes]:
    """Flux `chat.completion.chunk` : retire les blocs de code du contenu prononcé.

    Les blocs sont remis à `on_blocks` dès la fin de réponse (`finish_reason`), avant
    d'envoyer ce dernier morceau : le moteur vocal ferme la connexion aussitôt, et le
    générateur ne reprendrait pas après.
    """
    fences = FenceFilter()
    pending = b""
    full, spoken = "", ""
    delivered = False

    def deliver() -> None:
        nonlocal delivered
        if not delivered:
            delivered = True
            remember(spoken, full)
            on_blocks(fences.blocks)

    async for chunk in chunks:
        pending += chunk
        *lines, pending = pending.split(b"\n")
        out = []
        finished = False
        for line in lines:
            if line.startswith(b"data: {"):
                payload = json.loads(line[6:])
                for choice in payload.get("choices", []):
                    delta = choice.get("delta", {})
                    if delta.get("content"):
                        full += delta["content"]
                        delta["content"] = fences.feed(delta["content"])
                    if choice.get("finish_reason"):
                        delta["content"] = (delta.get("content") or "") + fences.flush()
                        finished = True
                    spoken += delta.get("content") or ""
                line = b"data: " + json.dumps(payload, ensure_ascii=False).encode()
            elif line.startswith(b"data: [DONE]"):
                finished = True
            out.append(line + b"\n")
        if finished:
            deliver()
        if out:
            yield b"".join(out)
    if pending:
        yield pending
    deliver()
