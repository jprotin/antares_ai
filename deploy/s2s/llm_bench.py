"""Banc d'essai des LLM Ollama pour la conversation vocale (stdlib uniquement).

À lancer sur l'hôte, moteur s2s démarré (VRAM occupée comme en usage réel) :
    python3 llm_bench.py gemma4:e4b gemma4:12b
Mesure par modèle : temps de chargement, délai avant le premier mot, débit, part en
VRAM, et les réponses aux mêmes questions. Résultat : out/llm/index.html
"""

import html
import http.client
import json
import sys
import time
import urllib.request
from pathlib import Path

OLLAMA = "http://127.0.0.1:11434"
ROUTER_MODELS = "http://127.0.0.1:8765/api/models"
OUT = Path(__file__).parent / "out" / "llm"
SYSTEM = (
    "Tu es une assistante vocale bienveillante. Réponds toujours en français, "
    "en phrases courtes et naturelles, sans markdown ni listes."
)
QUESTIONS = [
    "Bonjour, peux-tu me donner une idée de recette rapide pour ce soir ?",
    "Explique-moi simplement pourquoi le ciel est bleu.",
    "J'ai du mal à dormir en ce moment, tu as un conseil ?",
    "Je me sens un peu stressé par le travail ces temps-ci.",
    "Quelle est la différence entre un virus et une bactérie ?",
    "Aide-moi à préparer une question à poser à la fin de mon entretien d'embauche.",
    "J'ai trois pommes, j'en mange une, puis on m'en donne deux. Combien j'en ai ?",
    "Raconte-moi une courte histoire drôle.",
    "Donne-moi trois conseils pour économiser l'énergie à la maison.",
    "Résume-moi ce qu'est l'intelligence artificielle en deux phrases.",
]


def post(path: str, payload: dict) -> http.client.HTTPResponse:
    request = urllib.request.Request(
        f"{OLLAMA}{path}",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    return urllib.request.urlopen(request, timeout=600)


def unload_all() -> None:
    for running in json.load(urllib.request.urlopen(f"{OLLAMA}/api/ps"))["models"]:
        post("/api/generate", {"model": running["name"], "keep_alive": 0}).read()


def ask(model: str, question: str) -> dict:
    payload = {
        "model": model,
        "stream": True,
        "stream_options": {"include_usage": True},
        "reasoning_effort": "none",
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": question},
        ],
    }
    start = time.monotonic()
    first, text, reasoning, tokens = None, "", 0, None
    with post("/v1/chat/completions", payload) as response:
        for raw in response:
            line = raw.decode().strip()
            if not line.startswith("data: {"):
                continue
            chunk = json.loads(line[6:])
            if chunk.get("usage"):
                tokens = chunk["usage"]["completion_tokens"]
            for choice in chunk.get("choices", []):
                delta = choice.get("delta", {})
                reasoning += len(delta.get("reasoning") or "")
                if delta.get("content"):
                    first = first or time.monotonic() - start
                    text += delta["content"]
    total = time.monotonic() - start
    speed = tokens / (total - first) if tokens and first and total > first else None
    return {
        "question": question,
        "answer": text.strip(),
        "ttft": first,
        "total": total,
        "tokens": tokens,
        "speed": speed,
        "reasoningChars": reasoning,
    }


def bench(model: str) -> dict:
    print(f"== {model}", flush=True)
    unload_all()
    start = time.monotonic()
    post("/api/generate", {"model": model, "prompt": "", "keep_alive": "30m"}).read()
    load_s = time.monotonic() - start
    running = next(
        m
        for m in json.load(urllib.request.urlopen(f"{OLLAMA}/api/ps"))["models"]
        if m["name"] == model
    )
    urllib.request.urlopen(ROUTER_MODELS).read()  # mémorise la part GPU côté routeur
    answers = []
    for question in QUESTIONS:
        result = ask(model, question)
        answers.append(result)
        print(
            f"   1er mot {result['ttft']:.2f}s  {result['speed'] or 0:.0f} tok/s  {result['answer'][:70]!r}",
            flush=True,
        )
    ttfts = sorted(a["ttft"] for a in answers if a["ttft"])
    speeds = [a["speed"] for a in answers if a["speed"]]
    return {
        "model": model,
        "loadSeconds": round(load_s, 1),
        "gpuRatio": round(running["size_vram"] / running["size"], 2),
        "ttftMedian": round(ttfts[len(ttfts) // 2], 2),
        "ttftMax": round(ttfts[-1], 2),
        "speedMean": round(sum(speeds) / len(speeds)),
        "reasoningLeak": sum(a["reasoningChars"] for a in answers),
        "answers": answers,
    }


def write_page(results: list[dict]) -> None:
    head = "".join(f"<th>{html.escape(r['model'])}</th>" for r in results)
    metrics = [
        ("Chargement", lambda r: f"{r['loadSeconds']} s"),
        ("Part en GPU", lambda r: f"{round(r['gpuRatio'] * 100)} %"),
        (
            "1er mot (médiane / max)",
            lambda r: f"{r['ttftMedian']} s / {r['ttftMax']} s",
        ),
        ("Débit moyen", lambda r: f"{r['speedMean']} tokens/s"),
    ]
    rows = "".join(
        f"<tr><th>{name}</th>"
        + "".join(f"<td>{fmt(r)}</td>" for r in results)
        + "</tr>"
        for name, fmt in metrics
    )
    for i, question in enumerate(QUESTIONS):
        cells = "".join(
            f"<td>{html.escape(r['answers'][i]['answer'])}<small>{r['answers'][i]['ttft']:.2f} s</small></td>"
            for r in results
        )
        rows += f"<tr><th>{html.escape(question)}</th>{cells}</tr>"
    (OUT / "index.html").write_text(
        f"""<!doctype html><meta charset=utf-8><title>Banc LLM</title>
<style>body{{font-family:system-ui;background:#0b0f18;color:#e6ebf5;margin:2rem}}
table{{border-collapse:collapse}}th,td{{padding:.5rem .7rem;vertical-align:top;text-align:left;border-bottom:1px solid #1b2438}}
tbody th{{color:#8591a8;font-weight:500;max-width:16rem}}td{{max-width:22rem}}small{{display:block;color:#5a6479;margin-top:.3rem}}</style>
<h1>Banc LLM : conversation vocale</h1><p>Même consigne système que l'assistante, raisonnement désactivé, voix chargée en VRAM.</p>
<table><thead><tr><th></th>{head}</tr></thead><tbody>{rows}</tbody></table>""",
        encoding="utf-8",
    )
    (OUT / "results.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    results = [bench(model) for model in sys.argv[1:]]
    write_page(results)
    for r in results:
        print(
            f"{r['model']:<12} charge {r['loadSeconds']}s  GPU {round(r['gpuRatio'] * 100)}%  "
            f"1er mot {r['ttftMedian']}s (max {r['ttftMax']}s)  {r['speedMean']} tok/s  fuite raisonnement {r['reasoningLeak']}"
        )


if __name__ == "__main__":
    main()
