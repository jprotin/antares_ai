"""Documents joints à la conversation : extraction du texte, stockage, injection.

Leçons reprises d'ai-to-boost (ADR 0009) et mesurées ici :
- Ollama tronque le début d'un prompt trop long SANS erreur, et le modèle répond quand
  même : un document trop long est donc refusé explicitement, jamais tronqué ;
- le document va dans la consigne système, renvoyé à chaque tour, et avant les parties
  qui changent d'une question à l'autre (RAG) pour que le cache d'Ollama serve.

Limites (gemma4:e4b, 12 Go de VRAM partagés avec le moteur vocal, 2026-09-29) :
- voix : contexte par défaut d'Ollama (32 768) -> 20 000 tokens de documents ;
- écrit : contexte long (65 536, tient à 100 % sur le GPU) -> 56 000 tokens, lus en
  entier (repères début / milieu / fin retrouvés sur 48 800 tokens, 17,6 s).
"""

import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile
from pathlib import Path
from xml.etree import ElementTree

DOCS_DIR = Path(os.environ.get("DOCUMENTS_PATH", "/data/documents"))
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
MAX_IMAGE_BYTES = 5 * 1024 * 1024
# Estimation prudente pour le français (mesuré : 3,9 caractères par token)
CHARS_PER_TOKEN = 3.5
VOICE_MAX_TOKENS = 20_000
WRITTEN_MAX_TOKENS = 56_000
LONG_CONTEXT = 65_536
# Au-delà, l'écrit passe en contexte long (le contexte par défaut est de 32 768)
LONG_CONTEXT_FROM = VOICE_MAX_TOKENS

TEXT_TYPES = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".log", ".json", ".yaml", ".yml",
    ".xml", ".html", ".htm", ".ini", ".conf", ".cfg", ".toml", ".env.example",
    ".py", ".js", ".ts", ".sh", ".sql", ".php", ".go", ".rs", ".java", ".tf",
    ".dockerfile", ".properties",
}  # fmt: skip
IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}
WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class DocumentError(ValueError):
    """Refus explicite, affiché tel quel à l'utilisateur."""


def _number(value: int) -> str:
    return f"{value:,}".replace(",", " ")


def estimate_tokens(text: str) -> int:
    return int(len(text) / CHARS_PER_TOKEN) + 1


def _decode(data: bytes) -> str:
    for encoding in ("utf-8", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _pdf_text(data: bytes) -> str:
    if not shutil.which("pdftotext"):
        raise DocumentError(
            "lecture des PDF indisponible (pdftotext absent de l'image)"
        )
    with tempfile.NamedTemporaryFile(suffix=".pdf") as pdf:
        pdf.write(data)
        pdf.flush()
        result = subprocess.run(
            ["pdftotext", "-layout", "-enc", "UTF-8", pdf.name, "-"],
            capture_output=True,
            timeout=120,
            check=False,
        )
    if result.returncode != 0:
        raise DocumentError("PDF illisible (fichier endommagé ou protégé)")
    return result.stdout.decode("utf-8", errors="replace")


def _docx_text(data: bytes) -> str:
    with tempfile.TemporaryFile() as handle:
        handle.write(data)
        handle.seek(0)
        try:
            with zipfile.ZipFile(handle) as archive:
                xml = archive.read("word/document.xml")
        except (zipfile.BadZipFile, KeyError) as exc:
            raise DocumentError("document Word illisible") from exc
    paragraphs = []
    for paragraph in ElementTree.fromstring(xml).iter(f"{WORD_NS}p"):
        text = "".join(node.text or "" for node in paragraph.iter(f"{WORD_NS}t"))
        paragraphs.append(text)
    return "\n".join(paragraphs)


def _clean(text: str) -> str:
    text = text.replace("\x00", "").replace("\f", "\n")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def extract(name: str, data: bytes) -> dict:
    """Texte (ou image) d'un fichier envoyé ; lève DocumentError si inexploitable."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise DocumentError("fichier trop volumineux (15 Mo au maximum)")
    suffix = Path(name.lower()).suffix
    if name.lower() == "dockerfile":
        suffix = ".dockerfile"
    if suffix in IMAGE_TYPES:
        if len(data) > MAX_IMAGE_BYTES:
            raise DocumentError("image trop volumineuse (5 Mo au maximum)")
        return {
            "kind": "image",
            "mime": IMAGE_TYPES[suffix],
            "image": base64.b64encode(data).decode(),
            "tokens": 300,
        }
    if suffix == ".pdf":
        text = _pdf_text(data)
        if len(text.strip()) < 20:
            raise DocumentError(
                "PDF sans texte extractible (document scanné) : il faudrait une "
                "reconnaissance de caractères, non disponible"
            )
        kind = "pdf"
    elif suffix == ".docx":
        text, kind = _docx_text(data), "word"
    elif suffix in TEXT_TYPES or not suffix:
        text, kind = _decode(data), "texte"
    else:
        raise DocumentError(f"format non pris en charge ({suffix or 'sans extension'})")
    text = _clean(text)
    if not text:
        raise DocumentError("document vide")
    tokens = estimate_tokens(text)
    if tokens > WRITTEN_MAX_TOKENS:
        raise DocumentError(
            f"document trop long ({_number(tokens)} tokens estimés, "
            f"{_number(WRITTEN_MAX_TOKENS)} au maximum) : il serait tronqué sans "
            "prévenir ; découpez-le"
        )
    return {"kind": kind, "text": text, "tokens": tokens}


def save(name: str, extracted: dict) -> dict:
    DOCS_DIR.mkdir(parents=True, exist_ok=True)
    doc = {
        "id": uuid.uuid4().hex[:12],
        "name": name,
        "created": time.time(),
        **extracted,
    }
    (DOCS_DIR / f"{doc['id']}.json").write_text(
        json.dumps(doc, ensure_ascii=False), encoding="utf-8"
    )
    return doc


def load(doc_id: str) -> dict | None:
    if not re.fullmatch(r"[0-9a-f]{12}", doc_id):
        return None
    path = DOCS_DIR / f"{doc_id}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def delete(doc_id: str) -> None:
    if re.fullmatch(r"[0-9a-f]{12}", doc_id):
        (DOCS_DIR / f"{doc_id}.json").unlink(missing_ok=True)


def summary(doc: dict) -> dict:
    """Ce que l'interface affiche (sans le contenu)."""
    return {
        key: doc[key]
        for key in ("id", "name", "kind", "tokens", "created")
        if key in doc
    } | {"voice": doc["tokens"] <= VOICE_MAX_TOKENS}


def inject(
    messages: list[dict], docs: list[dict], spoken: bool
) -> tuple[list[dict], dict]:
    """Ajoute les documents à la consigne (texte) et au dernier message (images).

    Renvoie aussi l'usage : documents lus, écartés (trop longs pour la voix), tokens.
    """
    used: list[str] = []
    skipped: list[str] = []
    tokens = 0
    if not docs:
        return messages, {"used": used, "skipped": skipped, "tokens": 0, "images": 0}
    budget = VOICE_MAX_TOKENS if spoken else WRITTEN_MAX_TOKENS
    texts, images = [], []
    for doc in docs:
        if doc["kind"] == "image":
            images.append(doc)
            used.append(doc["name"])
            continue
        if tokens + doc["tokens"] > budget:
            skipped.append(doc["name"])
            continue
        tokens += doc["tokens"]
        used.append(doc["name"])
        texts.append(f"### Document : {doc['name']}\n{doc['text']}")

    augmented = [dict(m) for m in messages]
    blocks = []
    if texts:
        how = (
            "À l'oral, résume et réponds avec tes mots : ne lis jamais le document."
            if spoken
            else "Cite le nom du document concerné quand tu t'appuies dessus."
        )
        blocks.append(
            "Documents joints par l'utilisateur, à lire en entier et à utiliser pour "
            f"répondre. {how}\n\n" + "\n\n".join(texts)
        )
    if images:
        blocks.append(
            "Images jointes par l'utilisateur, fournies avec son dernier message : "
            + ", ".join(doc["name"] for doc in images)
            + ". Examine-les pour répondre."
        )
    if skipped:
        blocks.append(
            "Documents joints trop longs pour la conversation orale, non fournis ici : "
            + ", ".join(skipped)
            + ". Si la question porte dessus, dis-le et propose de la poser à l'écrit."
        )
    if blocks:
        text = "\n\n".join(blocks)
        system = next((m for m in augmented if m.get("role") == "system"), None)
        if system is not None:
            base = system["content"] if isinstance(system["content"], str) else ""
            # Documents en tête : préfixe stable d'une question à l'autre (cache Ollama)
            system["content"] = f"{base}\n\n{text}"
        else:
            augmented.insert(0, {"role": "system", "content": text})
    if images:
        last = next((m for m in reversed(augmented) if m.get("role") == "user"), None)
        if last is not None:
            content = last.get("content")
            parts = (
                content
                if isinstance(content, list)
                else [{"type": "text", "text": content or ""}]
            )
            parts = parts + [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{doc['mime']};base64,{doc['image']}"},
                }
                for doc in images
            ]
            last["content"] = parts
    return augmented, {
        "used": used,
        "skipped": skipped,
        "tokens": tokens,
        "images": len(images),
    }
