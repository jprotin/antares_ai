"""Sélection des articles et idées (digest.py) : formats de réponse, choix du modèle,
garde-fous, prompts, contrôle des réponses. `providers.complete` simulé : aucun vrai
modèle."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path

import httpx

import digest
from feeds import Article
from learning import Vote
from tasks_testing import FakeModel, config, resolve_ok, utc

NOW = utc(2026, 11, 16, 12, 0)
CFG = config()
FEATURES = """# Antares

## Modèles et réglages

- Connexions : fournisseurs Ollama et API compatibles OpenAI, modèle et repli choisis
  dans l'interface ; Claude en option par le pont de l'hôte.
- Répétition de présentation : slides, discours, questions du public.

## Backlog

- Archive et historique des appels.
"""


def candidates(n: int = 10, feed: str = "OpenAI") -> list[Article]:
    found = []
    for i in range(1, n + 1):
        found.append(
            Article(
                feed=feed,
                title=f"Titre {i}",
                url=f"https://openai.com/a{i}",
                summary=f"Résumé {i}",
                published=NOW,
                id=f"{i:016x}",
                lang="en",
                category="ia",
                ref=f"c{i}",
            )
        )
    return found


def articles_answer(*items) -> digest.ArticlesAnswer:
    return digest.parse_articles(json.dumps({"items": list(items)}))


def item(ref: str, sentence: str = "Phrase utile.", category: str = "cloud") -> dict:
    return {"ref": ref, "category": category, "sentence": sentence}


def idea(title: str, **extra) -> dict:
    return {
        "title": title,
        "benefit": "b",
        "effort": "M",
        "first_step": "f",
        **extra,
    }


def ideas_answer(*ideas) -> digest.IdeasAnswer:
    return digest.parse_ideas(json.dumps({"ideas": list(ideas)}))


def selected(n: int = 3) -> list[dict]:
    return digest.select_items(
        articles_answer(*(item(f"c{i}") for i in range(1, n + 1))),
        candidates(n),
        CFG,
    )


class Schemas(unittest.TestCase):
    def test_fichiers_egaux_aux_modeles(self):
        self.assertEqual(
            json.loads(digest.ARTICLES_SCHEMA_PATH.read_text(encoding="utf-8")),
            digest.articles_schema(),
        )
        self.assertEqual(
            json.loads(digest.IDEAS_SCHEMA_PATH.read_text(encoding="utf-8")),
            digest.ideas_schema(),
        )
        self.assertFalse(digest.SCHEMAS.joinpath("veille-reponse.schema.json").exists())

    def test_element_invalide_ecarte_seul(self):
        answer = digest.parse_ideas(
            json.dumps(
                {
                    "ideas": [
                        idea("Bonne", effort="S"),
                        idea("Effort XL", effort="XL"),
                        {"title": "Sans le reste"},
                        "texte",
                    ]
                }
            )
        )
        self.assertEqual([i.title for i in answer.ideas], ["Bonne"])
        items = digest.parse_articles(
            json.dumps({"items": [item("c1"), {"ref": "c2"}, 3]})
        )
        self.assertEqual([i.ref for i in items.items], ["c1"])

    def test_reponses_illisibles(self):
        for text in ("", "   ", '{"items": [', "Voici : ...", "[]", '{"items": 3}'):
            with self.assertRaises(digest.DigestError) as caught:
                digest.parse_articles(text)
            self.assertEqual(
                str(caught.exception),
                "Veille indisponible : réponse du modèle illisible",
            )
        with self.assertRaises(digest.DigestError) as caught:
            digest.parse_ideas('{"items": []}')
        self.assertEqual(
            str(caught.exception), "Idées indisponibles : réponse du modèle illisible"
        )

    def test_bloc_json_extrait(self):
        text = '```json\n{"items": []}\n```'
        self.assertEqual(digest.parse_articles(text).items, [])


class ChooseModel(unittest.TestCase):
    def settings(self, **values) -> Path:
        path = Path(tempfile.mkdtemp()) / "settings.json"
        path.write_text(json.dumps(values))
        return path

    def test_trois_sources(self):
        path = self.settings(
            model="litellm/gemma4:e4b-long", fallback="ollama/gemma4:e4b"
        )
        self.assertEqual(
            digest.choose_model("ollama/qwen3:8b", path, resolve_ok), "ollama/qwen3:8b"
        )
        self.assertEqual(
            digest.choose_model("", path, resolve_ok), "litellm/gemma4:e4b-long"
        )

    def test_repli_si_claude_ou_introuvable(self):
        for model in ("claude:opus", "absent/x", ""):
            path = self.settings(model=model, fallback="ollama/gemma4:e4b")
            self.assertEqual(
                digest.choose_model("", path, resolve_ok), "ollama/gemma4:e4b"
            )

    def test_aucun_modele(self):
        for path in (
            self.settings(model="claude:opus", fallback=""),
            Path("/nonexistent/settings.json"),
        ):
            with self.assertRaises(digest.DigestError) as caught:
                digest.choose_model("", path, resolve_ok)
            self.assertEqual(
                str(caught.exception), "Veille indisponible : modèle non configuré"
            )


class Connections(unittest.TestCase):
    REQUIRED = {"providers", "rag", "search", "claude", "mcp"}

    def test_absent(self):
        with self.assertRaises(digest.DigestError) as caught:
            digest.check_connections(
                Path("/nonexistent/connections.json"), self.REQUIRED
            )
        self.assertIn("routeur jamais démarré", str(caught.exception))

    def test_section_manquante_fichier_inchange(self):
        path = Path(tempfile.mkdtemp()) / "connections.json"
        path.write_text(json.dumps({"providers": []}))
        before = (path.stat().st_mtime_ns, path.read_text())
        with self.assertRaises(digest.DigestError) as caught:
            digest.check_connections(path, self.REQUIRED)
        self.assertIn("incomplète", str(caught.exception))
        self.assertEqual((path.stat().st_mtime_ns, path.read_text()), before)

    def test_complet(self):
        path = Path(tempfile.mkdtemp()) / "connections.json"
        path.write_text(json.dumps({k: [] for k in self.REQUIRED}))
        digest.check_connections(path, self.REQUIRED)


def ask(*answers, prefix=digest.VEILLE):
    model = FakeModel(*answers)
    messages = [{"role": "user", "content": "x"}]
    text = asyncio.run(
        digest.ask_model(model, "ollama/gemma4:e4b", messages, 3000, prefix=prefix)
    )
    return text, model


class AskModel(unittest.TestCase):
    def test_arguments(self):
        _, model = ask("{}")
        call = model.calls[0]
        self.assertEqual(call["name"], "ollama/gemma4:e4b")
        self.assertEqual(
            {k: call[k] for k in ("json_mode", "temperature", "max_tokens", "timeout")},
            {"json_mode": True, "temperature": 0.2, "max_tokens": 3000, "timeout": 300},
        )
        self.assertNotIn("num_ctx", json.dumps(call, default=str))

    def assertMessage(self, error, expected, prefix=digest.VEILLE):
        with self.assertRaises(digest.DigestError) as caught:
            ask(error, prefix=prefix)
        self.assertEqual(str(caught.exception), expected)

    def test_erreurs(self):
        request = httpx.Request("POST", "http://ollama:11434/api/chat")
        self.assertMessage(
            LookupError("x"), "Veille indisponible : modèle non configuré"
        )
        self.assertMessage(
            httpx.ConnectError("x", request=request),
            "Veille indisponible : modèle injoignable",
        )
        self.assertMessage(
            httpx.HTTPStatusError("404", request=request, response=httpx.Response(404)),
            "Veille indisponible : modèle injoignable",
        )
        self.assertMessage(
            json.JSONDecodeError("x", "doc", 0),
            "Veille indisponible : modèle injoignable",
        )
        self.assertMessage(
            KeyError("choices"), "Veille indisponible : réponse du modèle illisible"
        )
        self.assertMessage(
            httpx.ReadTimeout("délai"),
            "Idées indisponibles : modèle injoignable",
            prefix=digest.IDEAS,
        )


class SelectItems(unittest.TestCase):
    def test_champs_de_la_collecte(self):
        items = digest.select_items(
            articles_answer(item("c1"), item("c2")), candidates(), CFG
        )
        self.assertEqual(
            items[0],
            {
                "id": "0000000000000001",
                "ref": "c1",
                "title": "Titre 1",
                "url": "https://openai.com/a1",
                "source": "OpenAI",
                "lang": "en",
                "category": "cloud",
                "sentence": "Phrase utile.",
                "summary": "Résumé 1",
                "published_at": "2026-11-16T12:00:00+00:00",
            },
        )

    def test_candidat_inconnu_ecarte(self):
        items = digest.select_items(
            articles_answer(item("c1"), item("c99"), item("a2"), item("c2")),
            candidates(),
            CFG,
        )
        self.assertEqual([i["title"] for i in items], ["Titre 1", "Titre 2"])

    def test_champ_url_ignore(self):
        evil = {**item("c1"), "url": "http://evil.example.com", "title": "x"}
        items = digest.select_items(articles_answer(evil), candidates(), CFG)
        self.assertEqual(
            (items[0]["url"], items[0]["title"]), ("https://openai.com/a1", "Titre 1")
        )

    def test_categorie_inconnue_pre_categorie(self):
        items = digest.select_items(
            articles_answer(item("c1", category="sport"), item("c2", category="DEV")),
            candidates(),
            CFG,
        )
        self.assertEqual([i["category"] for i in items], ["ia", "dev"])

    def test_une_seule_phrase(self):
        items = digest.select_items(
            articles_answer(item("c1", "Phrase un. Phrase deux.")), candidates(), CFG
        )
        self.assertEqual(items[0]["sentence"], "Phrase un.")

    def test_au_plus_4_par_source_et_20_au_total(self):
        pool = candidates(23, "A") + [
            Article(
                feed="B",
                title=f"B {i}",
                url=f"https://b.example.com/{i}",
                summary="",
                published=NOW,
                id=f"{100 + i:016x}",
                category="ia",
                ref=f"c{30 + i}",
            )
            for i in range(7)
        ]
        many = [f"c{30 + i}" for i in range(7)] + [f"c{i}" for i in range(1, 24)]
        # 30 réponses valides, dont 7 de la source B
        items = digest.select_items(
            articles_answer(*(item(ref) for ref in many)), pool, CFG
        )
        self.assertLessEqual(len(items), 20)
        self.assertEqual(sum(1 for i in items if i["source"] == "B"), 4)
        self.assertEqual(sum(1 for i in items if i["source"] == "A"), 4)

    def test_trente_au_plus(self):
        pool = []
        for s in range(10):
            pool += [
                Article(
                    feed=f"S{s}",
                    title=f"T{s}-{i}",
                    url=f"https://s{s}.example.com/{i}",
                    summary="",
                    published=NOW,
                    id=f"{s * 10 + i:016x}",
                    category="ia",
                    ref=f"c{s * 10 + i + 1}",
                )
                for i in range(3)
            ]
        items = digest.select_items(
            articles_answer(*(item(a.ref) for a in pool)), pool, CFG
        )
        self.assertEqual(len(items), 30)

    def test_resume_hors_sujet_ecarte(self):
        cfg = config()
        cfg = cfg.model_copy(
            update={"digest": cfg.digest.model_copy(update={"check_summaries": True})}
        )
        pool = candidates(2)
        pool[0].title = "Anthropic ouvre ses services à l'autohébergement"
        pool[1].title = "Building trustworthy AI by fencing it in"
        answer = articles_answer(
            item("c1", "Anthropic permet l'autohébergement de certains services."),
            item("c2", "Des agents OpenAI désactivent leur sécurité."),
        )
        with self.assertLogs("tasks.digest", "INFO") as logs:
            items = digest.select_items(answer, pool, cfg)
        self.assertEqual([i["ref"] for i in items], ["c1"])
        self.assertTrue(any("OpenAI" in line for line in logs.output))
        self.assertTrue(
            any("2 proposés par le modèle, 1 gardés" in line for line in logs.output)
        )

    def test_renvois_retires(self):
        items = digest.select_items(
            articles_answer(item("c1", "Utile (c1) pour la voix [c2, c3] et c4 ici.")),
            candidates(),
            CFG,
        )
        self.assertEqual(items[0]["sentence"], "Utile pour la voix et ici.")

    def test_doublon_et_crochets(self):
        items = digest.select_items(
            articles_answer(item("[c1]"), item("c1"), item(" C2 ")), candidates(), CFG
        )
        self.assertEqual([i["ref"] for i in items], ["c1", "c2"])


def checks(**values) -> digest.IdeaChecks:
    return digest.IdeaChecks(**values)


def pick_ideas(*ideas, items=None, cfg=CFG, **check_values):
    return digest.select_ideas(
        ideas_answer(*ideas),
        items if items is not None else selected(),
        checks(**check_values),
        cfg,
        NOW,
    )


class Ideas(unittest.TestCase):
    def test_identifiant_et_inspiration(self):
        items = selected()
        ideas, keys = pick_ideas(
            idea("Cache RAG", inspired_by="c2"), idea("Sous-titres"), items=items
        )
        self.assertEqual(keys, ["cache rag", "sous titres"])
        self.assertRegex(ideas[0]["id"], r"^[0-9a-f]{16}$")
        self.assertEqual(ideas[0]["id"], digest.idea_id(NOW, "cache rag"))
        self.assertEqual(
            ideas[0]["inspired_by"],
            {"id": items[1]["id"], "title": "Titre 2", "url": "https://openai.com/a2"},
        )
        self.assertIsNone(ideas[1]["inspired_by"])

    def test_inspiration_inconnue_nulle(self):
        ideas, _ = pick_ideas(idea("Cache RAG", inspired_by="c99"))
        self.assertIsNone(ideas[0]["inspired_by"])

    def test_renvois_retires_de_tous_les_textes(self):
        ideas, _ = pick_ideas(
            idea(
                "Idée [c1]",
                benefit="Traçabilité (a11).",
                first_step="Lire c2 puis (cf. c12, c14) agir",
            )
        )
        self.assertEqual(
            (ideas[0]["title"], ideas[0]["benefit"], ideas[0]["first_step"]),
            ("Idée", "Traçabilité.", "Lire puis agir"),
        )

    def test_idee_proche_d_une_idee_passee(self):
        ideas, keys = pick_ideas(
            idea("Ajout d'un cache pour le RAG"),
            idea("Sous-titres"),
            past_keys=[digest.title_key("Ajouter un cache RAG")],
        )
        self.assertEqual([i["title"] for i in ideas], ["Sous-titres"])
        self.assertEqual(keys, ["sous titres"])

    def test_doublon_interne_et_vocabulaire_commun(self):
        ideas, _ = pick_ideas(idea("Cache des réponses"), idea("Cache de réponses"))
        self.assertEqual(len(ideas), 1)
        ideas, _ = pick_ideas(idea("Cache RAG"), idea("Cache TTS"))
        self.assertEqual(len(ideas), 2)

    def test_deja_dans_features(self):
        lines = digest.feature_lines(FEATURES)
        ideas, _ = pick_ideas(
            idea("Sélecteur de modèles Ollama"),
            idea("Historique des appels"),
            idea("Traduction simultanée"),
            features=lines,
        )
        self.assertEqual([i["title"] for i in ideas], ["Traduction simultanée"])

    def test_proche_d_une_idee_rejetee(self):
        rejected = [
            ("Tableau de bord des coûts", digest.title_key("Tableau de bord des coûts"))
        ]
        ideas, _ = pick_ideas(
            idea("Tableau des coûts par modèle"),
            idea("Traduction simultanée"),
            rejected=rejected,
        )
        self.assertEqual([i["title"] for i in ideas], ["Traduction simultanée"])

    def test_six_au_plus(self):
        titles = [
            "Traduction simultanée",
            "Mode podcast",
            "Résumé vocal du matin",
            "Rappels planifiés",
            "Lecture de flux audio",
            "Profil de voix par pièce",
            "Mesure du bruit ambiant",
            "Commandes domotiques",
        ]
        ideas, _ = pick_ideas(*(idea(t) for t in titles))
        self.assertEqual(len(ideas), 6)


class Prompts(unittest.TestCase):
    def test_articles(self):
        liked = [Vote("article", 1, "Aimé", NOW, source="AWS", category="cloud")]
        disliked = [Vote("article", -1, "Rejeté", NOW, source="X")]
        messages = digest.build_articles_messages(candidates(2), CFG, liked, disliked)
        system, user = messages[0]["content"], messages[1]["content"]
        self.assertIn('"items"', system)
        self.assertIn("Retiens 34 articles", system)
        self.assertIn('"ia", "cloud", "dev"', system)
        self.assertIn("## Goûts de l'utilisateur", user)
        self.assertIn("- Aimé (AWS, cloud)", user)
        self.assertIn("- Rejeté (X)", user)
        self.assertIn("[c1] (OpenAI, en, ia, 2026-11-16) Titre 1 — Résumé 1", user)

    def test_idees_sans_numero_hors_inspired_by(self):
        messages = digest.build_ideas_messages(
            selected(2), "# Antares", ["Idée A"], ["Aimée"], ["Rejetée"], CFG
        )
        system, user = messages[0]["content"], messages[1]["content"]
        self.assertIn('"ideas"', system)
        self.assertIn("Propose 8 idées", system)
        for text in ("# Antares", "- Idée A", "- Aimée", "- Rejetée"):
            self.assertIn(text, user)
        news = [line for line in user.splitlines() if "Titre 1" in line]
        self.assertEqual(news, ['- inspired_by="c1" : Titre 1 (cloud) — Phrase utile.'])

    def test_features_tronque_et_absent(self):
        long = Path(__file__).with_name("fixtures") / "features_long.md"
        self.assertEqual(len(digest.read_features(long, 4000)), 4000)
        self.assertEqual(digest.read_features(Path("/nonexistent/FEATURES.md")), "")
        messages = digest.build_ideas_messages([], "", [], [], [], CFG)
        self.assertIn("(liste indisponible)", messages[1]["content"])
        self.assertIn("(aucune)", messages[1]["content"])


if __name__ == "__main__":
    unittest.main()
