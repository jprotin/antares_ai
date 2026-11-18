"""Tests de veille_journal : questions sur la veille et journal présenté par l'avatar."""

import unittest

import veille_journal as vj


def item(n: int, category: str, vote=None, title=None) -> dict:
    return {
        "id": f"a{n:015d}",
        "title": title or f"Titre {n}",
        "url": f"https://example.org/{n}",
        "source": f"Source {n}",
        "lang": "fr",
        "category": category,
        "sentence": f"Phrase {n}.",
        "summary": f"Résumé {n}. " * 100,
        "published_at": None,
        "vote": vote,
    }


def latest(items=None, ideas=None, weather=True) -> dict:
    return {
        "run": {
            "id": 7,
            "slot_at": "2026-11-17T12:00:00+00:00",
            "items": items
            if items is not None
            else [
                item(1, "ia", title="Mistral publie un modèle vocal"),
                item(2, "ia"),
                item(3, "cloud", title="Kubernetes 1.40 arrive"),
                item(4, "dev"),
                item(5, "securite"),
                item(6, "ia"),
                item(7, "cloud"),
            ],
            "ideas": ideas
            if ideas is not None
            else [
                {"id": "b1", "title": "Idée A", "benefit": "Gain A"},
                {"id": "b2", "title": "Idée B", "benefit": "Gain B"},
                {"id": "b3", "title": "Idée C", "benefit": "Gain C"},
            ],
        },
        "weather": {
            "text": "Le Pellerin : 6 à 12 °C",
            "condition": {"label": "Pluie"},
        }
        if weather
        else None,
        "categories": [
            {"slug": "ia", "label": "IA"},
            {"slug": "cloud", "label": "Cloud"},
        ],
    }


def system_of(messages: list[dict]) -> str:
    """Consigne complète du tour : système (personnage, règles) + note de régie."""
    return messages[0]["content"] + "\n" + messages[-1]["content"]


class Wanted(unittest.TestCase):
    def test_veille_words(self):
        for q in (
            "Quoi de neuf dans l'IA aujourd'hui ?",
            "Tu as vu les actus ?",
            "Il fait quel temps, la météo ?",
            "C'est quoi tes idées du jour ?",
            "Parle-moi de la veille",
        ):
            self.assertTrue(vj.wanted(q, latest()), q)

    def test_title_words(self):
        self.assertTrue(vj.wanted("Et ce truc sur Mistral ?", latest()))
        self.assertTrue(vj.wanted("kubernetes ça change quoi", latest()))

    def test_unrelated(self):
        for q in (
            "Explique-moi les closures en Python",
            "J'ai une idée de recette",
            "",
        ):
            self.assertFalse(vj.wanted(q, latest()), q)

    def test_no_run(self):
        self.assertFalse(vj.wanted("quoi de neuf ?", {"run": None}))
        self.assertFalse(vj.wanted("quoi de neuf ?", latest(items=[])))

    def test_journal_asked(self):
        self.assertTrue(vj.journal_asked("Fais-moi le journal"))
        self.assertTrue(vj.journal_asked("tu me lances ton récap ?"))
        self.assertTrue(vj.journal_asked(f"{vj.MARKER} Lance le journal."))
        self.assertFalse(vj.journal_asked("je lis le journal le matin"))


class Context(unittest.TestCase):
    def test_contents_and_rules(self):
        text = vj.context(latest())
        self.assertIn("Météo : Le Pellerin : 6 à 12 °C (Pluie)", text)
        self.assertIn(
            "[IA] Mistral publie un modèle vocal : Phrase 1. (Source 1)", text
        )
        self.assertIn("Idée A : Gain A", text)
        self.assertIn("ne lis jamais", text)
        self.assertIn("demande-lui ce qu'il en pense", text)
        self.assertNotIn("https://", text)

    def test_limits_items(self):
        many = latest(items=[item(n, "ia") for n in range(1, 40)])
        self.assertEqual(vj.context(many).count("\n- [IA]"), vj.CONTEXT_ITEMS)

    def test_empty(self):
        self.assertEqual(vj.context({"run": None}), "")

    def test_cited_article_first(self):
        many = [item(n, "ia") for n in range(1, 40)]
        many.append(item(40, "ia", title="Nvidia crée un comité"))
        text = vj.context(latest(items=many), "Tu as vu le truc sur Nvidia ?")
        self.assertIn("Nvidia crée un comité", text)
        self.assertLess(text.index("Nvidia"), text.index("Titre 1 "))


class Topics(unittest.TestCase):
    def test_diverse_categories_in_run_order(self):
        topics = vj.pick_topics(latest()["run"])
        self.assertEqual([t["id"][-1] for t in topics], ["1", "2", "3", "4", "5"])
        self.assertEqual(
            {t["category"] for t in topics[:4]} | {topics[4]["category"]},
            {"ia", "cloud", "dev", "securite"},
        )

    def test_liked_first_disliked_never(self):
        items = [
            item(1, "ia", vote="dislike"),
            item(2, "ia"),
            item(3, "cloud", vote="like"),
        ]
        topics = vj.pick_topics({"items": items})
        self.assertEqual([t["id"][-1] for t in topics], ["3", "2"])

    def test_one_per_category_first(self):
        items = [item(n, "ia") for n in range(1, 6)] + [item(9, "cloud")]
        ids = [t["id"][-1] for t in vj.pick_topics({"items": items})]
        self.assertIn("9", ids)
        self.assertEqual(len(ids), vj.TOPICS)


class Journal(unittest.TestCase):
    def setUp(self):
        vj.stop()
        vj.start(latest())

    def tearDown(self):
        vj.stop()

    def turn(self, said: str) -> str:
        out = vj.messages_for(
            [
                {"role": "system", "content": "Tu es Bender."},
                {"role": "assistant", "content": "Avant."},
                {"role": "user", "content": said},
            ]
        )
        self.assertEqual(out[-1]["role"], "user")
        self.assertNotIn(vj.MARKER, out[-1]["content"])
        self.assertIn("[Régie : ", out[-1]["content"])
        return system_of(out)

    def test_start_requires_run(self):
        with self.assertRaises(ValueError):
            vj.start({"run": None})

    def test_full_journal(self):
        first = self.turn(f"{vj.MARKER} Lance le journal.")
        self.assertTrue(first.startswith("Tu es Bender."))
        self.assertIn("JOURNAL DE LA VEILLE", first)
        self.assertIn("météo", first)
        self.assertIn("Mistral publie", first)
        self.assertEqual(vj.state()["current_id"], "a000000000000001")
        for n in range(2, 6):
            system = self.turn("Je trouve ça plutôt intéressant.")
            self.assertIn("Réagis d'abord", system)
            self.assertIn(f"Phrase {n}.", system)
            self.assertEqual(vj.state()["index"], n - 1)
        ideas = self.turn("Pas mal.")
        self.assertIn("Idée A", ideas)
        self.assertIn("Idée B", ideas)
        self.assertNotIn("Idée C", ideas)
        self.assertIsNone(vj.state()["current_id"])
        outro = self.turn("La première.")
        self.assertIn("onclus le journal", outro)
        vj.finish_if_done()
        self.assertFalse(vj.state()["active"])

    def test_more_and_question_stay_on_topic(self):
        self.turn(f"{vj.MARKER} Lance le journal.")
        more = self.turn("Raconte-m'en plus")
        self.assertIn("développe", more)
        self.assertIn("Résumé 1.", more)
        question = self.turn("Pourquoi ils font ça ?")
        self.assertIn("Réponds à sa question", question)
        self.assertEqual(vj.state()["index"], 0)
        self.assertEqual(vj.state()["current_id"], "a000000000000001")
        self.turn("D'accord")
        self.assertEqual(vj.state()["index"], 1)

    def test_skip_without_reaction(self):
        self.turn(f"{vj.MARKER} Lance le journal.")
        skipped = self.turn("Bof, suivant")
        self.assertNotIn("Réagis d'abord", skipped)
        self.assertIn("Phrase 2.", skipped)
        button = self.turn(f"{vj.MARKER} Sujet suivant.")
        self.assertIn("Phrase 3.", button)

    def test_stop(self):
        self.turn(f"{vj.MARKER} Lance le journal.")
        outro = self.turn("Stop, ça suffit")
        self.assertIn("onclus le journal", outro)
        self.assertNotIn("Réagis", outro)
        vj.finish_if_done()
        self.assertFalse(vj.active())

    def test_voice_request_opens(self):
        system = self.turn("Fais-moi le journal")
        self.assertIn("Ouvre le journal", system)

    def test_no_ideas_goes_to_outro(self):
        vj.start(latest(items=[item(1, "ia")], ideas=[]))
        self.turn(f"{vj.MARKER} Lance le journal.")
        self.assertIn("onclus", self.turn("Super"))

    def test_history_is_short(self):
        history = [{"role": "system", "content": "Perso"}]
        for n in range(10):
            history += [
                {"role": "user", "content": f"u{n}"},
                {"role": "assistant", "content": f"a{n}"},
            ]
        history.append({"role": "user", "content": f"{vj.MARKER} Lance le journal."})
        out = vj.messages_for(history)
        self.assertEqual(len(out), 1 + vj.HISTORY_TURNS)
        self.assertTrue(out[-1]["content"].startswith("[Régie : Ouvre le journal"))
        self.assertEqual(out[-2], {"role": "assistant", "content": "a9"})

    def test_expires(self):
        vj.live["at"] = 0
        self.assertFalse(vj.active(now=vj.LIVE_TTL_S + 1))


if __name__ == "__main__":
    unittest.main()
