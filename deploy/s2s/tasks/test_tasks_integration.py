"""Intégration du service : vraie base, vraie collecte, vraie planification ; seuls le
transport HTTP, le modèle, l'horloge et le sommeil sont simulés (I-01 à I-16)."""

import asyncio
import json
import os
import unittest
from datetime import timedelta
from pathlib import Path

import httpx

import jobs
import weather
from settings import Feed
from tasks_testing import (
    Clock,
    Env,
    FakeModel,
    Web,
    answer_for,
    config,
    fixture,
    is_ideas_call,
    utc,
    write_votes,
    xml,
)

METEO = httpx.Response(200, content=fixture("open_meteo.json"))
# 2026-11-16 08:00 Paris = 07:00 UTC ; 13:00 = 12:00 UTC ; 18:00 = 17:00 UTC
AT8, AT13, AT18 = utc(2026, 11, 16, 7), utc(2026, 11, 16, 12), utc(2026, 11, 16, 17)


def eight_feeds():
    base = config()
    feeds_list = [
        Feed(name=f"F{i}", url=f"https://f{i}.example.com/rss") for i in range(8)
    ]
    return base.model_copy(update={"feeds": feeds_list})


def web_for(cfg, broken=(6, 7)) -> Web:
    web = Web().add(weather.API, METEO)
    names = [
        "rss_openai.xml",
        "atom_github_releases.xml",
        "rss_hn.xml",
        "rss_html_summary.xml",
        "rss_injection.xml",
        "rss_latin1.xml",
    ]
    for i, feed in enumerate(cfg.feeds):
        if i == broken[0]:
            web.add(feed.url, httpx.Response(500))
        elif i == broken[1]:
            web.add(feed.url, xml("invalid.xml"))
        else:
            web.add(feed.url, xml(names[i % len(names)]))
    return web


def article_calls(model: FakeModel) -> list[dict]:
    return [c for c in model.calls if not is_ideas_call(c["messages"])]


def shown(model: FakeModel, call: int = -1) -> list[str]:
    """Articles du dernier prompt « articles » (sans leur numéro, qui dépend du score)."""
    content = article_calls(model)[call]["messages"][1]["content"]
    return sorted(
        line.split("] ", 1)[1] for line in content.splitlines() if line.startswith("[c")
    )


class Integration(unittest.TestCase):
    def setUp(self):
        self.env = Env()
        self.cfg = eight_feeds()
        self.web = web_for(self.cfg)
        self.model = FakeModel(answer_for)
        self.clock = Clock(AT8)
        self.ctx = self.env.context(self.web, self.model, self.clock, self.cfg)
        self.ctx.store.init(utc(2026, 11, 15))

    def slot(self, at):
        self.clock.current = at
        return asyncio.run(jobs.run_slot(self.ctx, at))

    def test_I01_creneau_de_8h_complet(self):
        result = self.slot(AT8)
        record = result.record
        self.assertEqual(record.status, "done")
        self.assertEqual(
            record.errors, ["Flux F6 indisponible", "Flux F7 indisponible"]
        )
        self.assertEqual(
            result.weather["text"],
            "Le Pellerin : 6 à 12 °C, pluie 40 %, vent jusqu'à 35 km/h",
        )
        self.assertEqual(result.weather["condition"]["key"], "rain")
        self.assertEqual(result.weather["hours"][0]["at"], "2026-11-16T08:00:00+01:00")
        self.assertEqual(
            self.ctx.store.weather("2026-11-16")["text"], result.weather["text"]
        )
        self.assertGreater(self.ctx.store.count("seen_urls"), 5)
        # « Déjà vus » : les articles affichés seulement, pas les autres candidats
        shown = {i["url"] for i in record.items}
        self.assertEqual(self.ctx.store.seen(shown), shown)
        skipped = [a["url"] for a in result.articles if a["url"] not in shown]
        self.assertTrue(skipped)
        self.assertEqual(self.ctx.store.seen(skipped), set())
        self.assertEqual(self.ctx.store.slots_since(AT8)[0]["status"], "done")
        self.assertTrue(all(i["url"].startswith("http") for i in record.items))
        self.assertEqual(len(record.ideas), 2)
        # Deux appels séparés : articles puis idées
        self.assertEqual(
            [is_ideas_call(c["messages"]) for c in self.model.calls], [False, True]
        )
        item = record.items[0]
        self.assertEqual(
            set(item),
            {
                "id",
                "title",
                "url",
                "source",
                "lang",
                "category",
                "sentence",
                "summary",
                "published_at",
            },
        )
        self.assertRegex(item["id"], r"^[0-9a-f]{16}$")
        self.assertEqual(item["category"], "ia")
        idea = record.ideas[0]
        self.assertRegex(idea["id"], r"^[0-9a-f]{16}$")
        self.assertEqual(idea["inspired_by"]["id"], record.items[0]["id"])
        self.assertIsNone(record.ideas[1]["inspired_by"])

    def test_I02_8h_puis_13h(self):
        self.slot(AT8)
        first = set(shown(self.model))
        self.slot(AT13)
        # À 13 h, les articles affichés à 8 h ne reviennent pas ; les autres candidats
        # de 8 h, non retenus par le modèle, sont proposés à nouveau
        self.assertEqual(len(self.model.calls), 4)
        runs = self.ctx.store.runs()
        self.assertEqual([r["status"] for r in runs], ["done", "done"])
        items = [json.loads(r["items_json"]) for r in runs]
        urls = [{i["url"] for i in run} for run in items]
        self.assertTrue(urls[0] and urls[1])
        self.assertFalse(urls[0] & urls[1])
        self.assertTrue(set(shown(self.model)) < first)

    def test_I02b_meteo_relevee_a_chaque_passage(self):
        self.slot(AT8)
        result = self.slot(AT18)
        self.assertEqual(self.web.hits(weather.API), 2)
        self.assertEqual(self.ctx.store.count("weather"), 1)
        stored = self.ctx.store.weather("2026-11-16")
        self.assertEqual(stored["fetched_at"], "2026-11-16T17:00:00+00:00")
        # Passage de 18 h : la frise commence à 18 h
        self.assertEqual(result.weather["hours"][0]["at"], "2026-11-16T18:00:00+01:00")

    def test_I02c_meteo_au_premier_creneau_seulement(self):
        cfg = self.cfg.model_copy(
            update={"weather": self.cfg.weather.model_copy(update={"every_run": False})}
        )
        self.ctx.config = cfg
        self.slot(AT8)
        result = self.slot(AT13)
        self.assertEqual(self.web.hits(weather.API), 1)
        self.assertIn("Le Pellerin", result.weather["text"])

    def test_I03_essai_a_blanc_puis_passage_reel(self):
        self.clock.current = AT8
        dry = self.env.context(
            self.web, self.model, self.clock, self.cfg, readonly=True
        )
        asyncio.run(jobs.run_veille(dry, dry_run=True, with_weather=True))
        before = shown(self.model)
        self.assertEqual(self.ctx.store.count("seen_urls"), 0)
        self.assertEqual(self.ctx.store.count("runs"), 0)
        self.assertEqual(self.ctx.store.count("weather"), 0)
        self.slot(AT13)
        self.assertEqual(shown(self.model), before)

    def test_I04_modele_illisible_puis_valide(self):
        self.model.answers = [""]
        failed = self.slot(AT13)
        self.assertEqual(failed.record.status, "failed")
        self.assertIn(
            "Veille indisponible : réponse du modèle illisible", failed.record.errors
        )
        first = shown(self.model)
        self.model.answers = [answer_for]
        self.slot(AT18)
        self.assertEqual(shown(self.model), first)
        self.assertEqual(
            [r["status"] for r in self.ctx.store.runs()], ["failed", "done"]
        )

    def test_I06_journee_simulee(self):
        self.clock.current = utc(2026, 11, 16, 6, 30)
        days = []
        asyncio.run(
            jobs.serve(
                self.ctx,
                stop=lambda: days.append(1) or self.clock.now() > utc(2026, 11, 16, 22),
            )
        )
        runs = self.ctx.store.runs()
        self.assertEqual(
            [r["slot_at"] for r in runs],
            [
                "2026-11-16T07:00:00+00:00",
                "2026-11-16T12:00:00+00:00",
                "2026-11-16T17:00:00+00:00",
            ],
        )
        self.assertTrue(all(s <= 60 for s in self.clock.slept))

    def test_I07_changement_d_heure_25_octobre(self):
        env = Env()
        self.clock.current = utc(2026, 10, 24, 22)
        ctx = env.context(self.web, self.model, self.clock, self.cfg)
        asyncio.run(
            jobs.serve(ctx, stop=lambda: self.clock.now() > utc(2026, 10, 25, 20))
        )
        self.assertEqual(
            [r["slot_at"] for r in ctx.store.runs()],
            [
                "2026-10-25T07:00:00+00:00",
                "2026-10-25T12:00:00+00:00",
                "2026-10-25T17:00:00+00:00",
            ],
        )

    def test_I08_appel_actif_6_minutes(self):
        async def turns():
            now = self.clock.now()
            return (
                (now - timedelta(seconds=5)).timestamp()
                if now < AT13 + timedelta(minutes=4)
                else (AT13 + timedelta(minutes=4)).timestamp()
            )

        self.ctx.read_last_turn = turns
        self.clock.current = AT13
        asyncio.run(jobs.tick(self.ctx))
        run = self.ctx.store.runs()[0]
        self.assertEqual(run["status"], "done")
        self.assertEqual(run["started_at"], "2026-11-16T12:06:00+00:00")

    def test_I09_deux_processus_meme_creneau(self):
        other = self.env.context(self.web, self.model, self.clock, self.cfg)
        self.clock.current = AT13

        async def both():
            return await asyncio.gather(
                jobs.run_slot(self.ctx, AT13), jobs.run_slot(other, AT13)
            )

        results = asyncio.run(both())
        self.assertEqual(sum(1 for r in results if r), 1)
        self.assertEqual(self.ctx.store.count("runs"), 1)
        # Lancement manuel en parallèle : pas de créneau, pas de verrou bloquant
        asyncio.run(jobs.run_veille(other))
        self.assertEqual(self.ctx.store.count("runs"), 2)
        self.assertEqual(self.ctx.store.count("slots"), 1)

    def test_I10_veille_vide(self):
        # Passages successifs jusqu'à épuisement des articles : le dernier, vide, ne
        # rappelle pas le modèle
        self.slot(AT8)
        for _ in range(30):
            calls = len(self.model.calls)
            result = asyncio.run(jobs.run_veille(self.ctx))
            if not result.record.items:
                break
        self.assertEqual(len(self.model.calls), calls)
        self.assertEqual((result.record.status, result.record.items), ("done", []))

    def test_I11_tous_les_flux_en_panne(self):
        web = Web().add(weather.API, METEO)
        ctx = self.env.context(web, self.model, self.clock, self.cfg)
        self.clock.current = AT13
        result = asyncio.run(jobs.run_slot(ctx, AT13))
        self.assertEqual(result.record.status, "failed")
        self.assertEqual(len(result.record.errors), 9)
        self.assertEqual(
            result.record.errors[-1], "Veille indisponible : aucun flux lisible"
        )
        self.assertEqual(self.model.calls, [])

    def test_I13_idees_en_echec_passage_reussi(self):
        def answers(messages):
            if is_ideas_call(messages):
                return "pas du json"
            return answer_for(messages)

        self.model.answers = [answers]
        result = self.slot(AT13)
        self.assertEqual(result.record.status, "done")
        self.assertTrue(result.record.items)
        self.assertEqual(result.record.ideas, [])
        self.assertIn(
            "Idées indisponibles : réponse du modèle illisible", result.record.errors
        )
        self.assertEqual(self.ctx.store.count("ideas"), 0)

    def test_I14_votes_appris(self):
        # F0 (rss_openai) rejetée 5 fois, F1 (atom_github_releases) aimée 5 fois
        rows = [
            {
                "target_id": f"{i:016x}",
                "value": -1 if i < 5 else 1,
                "title": f"Vote {i}",
                "source": "F0" if i < 5 else "F1",
                "category": "ia",
                "voted_at": "2026-11-16T06:00:00+00:00",
            }
            for i in range(10)
        ]
        rows.append(
            {
                "kind": "idea",
                "target_id": "f" * 16,
                "value": -1,
                "title": "Mesure de latence des modèles",
                "voted_at": "2026-11-16T06:00:00+00:00",
            }
        )
        write_votes(self.env.votes, rows)
        result = self.slot(AT13)
        content = article_calls(self.model)[0]["messages"][1]["content"]
        self.assertIn("## Goûts de l'utilisateur", content)
        self.assertIn("- Vote 9 (F1, ia)", content)
        self.assertIn("- Vote 0 (F0, ia)", content)
        sources = [a["feed"] for a in result.articles]
        self.assertLess(sources.index("F1"), sources.index("F0"))
        # Idée proche d'une idée rejetée : écartée ; titre rejeté montré au modèle
        self.assertEqual(
            [i["title"] for i in result.record.ideas], ["Sous-titres exportables"]
        )
        ideas_prompt = self.model.calls[-1]["messages"][1]["content"]
        self.assertIn("- Mesure de latence des modèles", ideas_prompt)

    def test_I15_base_de_votes_absente(self):
        with self.assertLogs("tasks", level="WARNING") as logs:
            result = self.slot(AT13)
        self.assertEqual(result.record.status, "done")
        self.assertTrue(any("scores neutres" in line for line in logs.output))

    def test_I16_idee_deja_dans_features(self):
        self.env.features.write_text(
            "# Antares\n- Sous-titres exportables en texte\n", encoding="utf-8"
        )
        result = self.slot(AT13)
        self.assertEqual(
            [i["title"] for i in result.record.ideas], ["Mesure de latence par modèle"]
        )

    def test_I12_purge(self):
        old = utc(2026, 10, 10, 12)
        self.clock.current = old
        asyncio.run(jobs.run_veille(self.ctx))
        seen = self.ctx.store.count("seen_urls")
        self.slot(AT13 + timedelta(days=5))
        self.assertEqual(len(self.ctx.store.runs()), 1)
        self.assertGreaterEqual(self.ctx.store.count("seen_urls"), seen)


class Planning(unittest.TestCase):
    """Créneaux manqués (U-PL-07 à 13) sur une vraie base."""

    def setUp(self):
        self.env = Env()
        self.cfg = config()
        self.web = web_for(eight_feeds())
        self.model = FakeModel(answer_for)

    def ctx(self, now, first_start):
        clock = Clock(now)
        ctx = self.env.context(self.web, self.model, clock, eight_feeds())
        ctx.store.init(first_start)
        return ctx, clock

    def test_arret_de_12h_a_14h(self):
        ctx, _ = self.ctx(utc(2026, 11, 16, 13), utc(2026, 11, 10))
        asyncio.run(jobs.tick(ctx))
        slots = {
            s["slot_key"]: s["status"] for s in ctx.store.slots_since(utc(2026, 11, 16))
        }
        self.assertEqual(slots["2026-11-16T13:00+01:00/veille"], "missed")
        self.assertEqual(ctx.store.count("runs"), 0)

    def test_redemarrage_dans_la_tolerance(self):
        ctx, _ = self.ctx(utc(2026, 11, 16, 12, 10), utc(2026, 11, 10))
        self.assertEqual(asyncio.run(jobs.tick(ctx)), 1)

    def test_creneau_deja_fait(self):
        ctx, _ = self.ctx(utc(2026, 11, 16, 12, 1), utc(2026, 11, 10))
        asyncio.run(jobs.tick(ctx))
        self.assertEqual(asyncio.run(jobs.tick(ctx)), 0)
        self.assertEqual(ctx.store.count("runs"), 1)

    def test_premiere_installation_sans_historique(self):
        now = utc(2026, 11, 16, 15)
        ctx, _ = self.ctx(now, now)
        asyncio.run(jobs.tick(ctx))
        self.assertEqual(ctx.store.count("slots"), 0)

    def test_base_purgee_rien_de_re_note(self):
        ctx, _ = self.ctx(utc(2026, 11, 16, 15), utc(2026, 9, 1))
        asyncio.run(jobs.tick(ctx))
        # Fenêtre bornée à 24 h : 18 h de la veille, 8 h et 13 h du jour, rien d'avant
        slots = ctx.store.slots_since(utc(2026, 9, 1))
        self.assertEqual(
            [s["slot_key"] for s in slots],
            [
                "2026-11-15T18:00+01:00/veille",
                "2026-11-16T08:00+01:00/veille",
                "2026-11-16T13:00+01:00/veille",
            ],
        )
        self.assertTrue(all(s["status"] == "missed" for s in slots))

    def test_saut_d_horloge_de_3h(self):
        ctx, clock = self.ctx(utc(2026, 11, 16, 6, 30), utc(2026, 11, 10))
        asyncio.run(jobs.tick(ctx))
        clock.advance(hours=3)  # mise en veille du poste
        asyncio.run(jobs.tick(ctx))
        self.assertEqual(ctx.store.count("runs"), 0)
        statuses = {
            s["slot_key"]: s["status"] for s in ctx.store.slots_since(utc(2026, 11, 16))
        }
        self.assertEqual(statuses["2026-11-16T08:00+01:00/veille"], "missed")

    def test_lancement_manuel_ne_prend_pas_de_creneau(self):
        ctx, clock = self.ctx(utc(2026, 11, 16, 11, 55), utc(2026, 11, 10))
        asyncio.run(jobs.run_veille(ctx))
        clock.current = utc(2026, 11, 16, 12, 0)
        self.assertEqual(asyncio.run(jobs.tick(ctx)), 1)

    def test_schedule_rapport(self):
        ctx, _ = self.ctx(utc(2026, 11, 16, 13), utc(2026, 11, 10))
        asyncio.run(jobs.tick(ctx))
        report = jobs.schedule_report(ctx)
        self.assertIn(
            "2026-11-16 18:00 (Europe/Paris, +0100) = 2026-11-16 17:00 UTC", report
        )
        self.assertIn(
            "2026-11-17 08:00 (Europe/Paris, +0100) = 2026-11-17 07:00 UTC (météo puis veille)",
            report,
        )
        self.assertIn("Dernier passage réussi : aucun", report)
        self.assertIn("2026-11-16T13:00+01:00/veille (missed)", report)


class Contract(unittest.TestCase):
    """I-05 : la base écrite par le service est lue par router/veille.py ; la réponse a
    les clés et types de la fixture de l'interface (référence de forme partagée)."""

    # Dans l'image : -v "$PWD/../../web/tests/fixtures/api:/web-fixtures:ro"
    #                -e VEILLE_FIXTURE=/web-fixtures/veille_latest.json
    FIXTURE = Path(
        os.environ.get(
            "VEILLE_FIXTURE",
            Path(__file__).resolve().parent
            / "../../../web/tests/fixtures/api/veille_latest.json",
        )
    )

    def shape(self, value):
        """Clés (récursives) et types ; `null` compatible avec tout type."""
        if isinstance(value, dict):
            return {k: self.shape(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self.shape(value[0])] if value else []
        return type(value).__name__

    def assertSameShape(self, got, expected, where="racine"):
        if got is None or expected is None:
            return
        if isinstance(expected, dict):
            self.assertIsInstance(got, dict, where)
            self.assertEqual(set(got), set(expected), where)
            for key in expected:
                self.assertSameShape(got[key], expected[key], f"{where}.{key}")
        elif isinstance(expected, list):
            self.assertIsInstance(got, list, where)
            if got and expected:
                self.assertSameShape(got[0], expected[0], f"{where}[0]")
        elif isinstance(expected, bool) or isinstance(got, bool):
            self.assertIs(type(got), type(expected), where)
        elif isinstance(expected, (int, float)):
            self.assertIsInstance(got, (int, float), where)
        else:
            self.assertIs(type(got), type(expected), where)

    def test_I05_contrat_service_routeur(self):
        try:
            import veille
            import veille_votes
        except ImportError:
            self.skipTest("router/ absent du PYTHONPATH")
        if not self.FIXTURE.exists():
            self.skipTest("web/ non monté (fixture de forme absente)")
        expected = json.loads(self.FIXTURE.read_text(encoding="utf-8"))
        if "categories" not in expected:
            self.skipTest("fixture de l'interface encore au schéma 1")
        env = Env()
        cfg = eight_feeds()
        clock = Clock(AT8)
        ctx = env.context(web_for(cfg), FakeModel(answer_for), clock, cfg)
        ctx.store.init(utc(2026, 11, 15))
        asyncio.run(jobs.run_slot(ctx, AT8))
        clock.current = AT13
        ctx.store.mark_missed(
            "2026-11-16T13:00+01:00/veille", "veille", "2026-11-16", AT13, AT18
        )
        run = ctx.store.runs()[0]
        first_item = json.loads(run["items_json"])[0]
        first_idea = json.loads(run["ideas_json"])[0]
        votes = veille_votes.VotesDB(env.votes)
        votes.set_vote("article", first_item["id"], "like", {"title": "t"}, AT18)
        votes.set_vote("idea", first_idea["id"], "like", {"title": "t"}, AT18)
        votes.save_prompt(first_idea["id"], "# Contexte", "m", AT18)
        categories = [{"slug": c.slug, "label": c.label} for c in cfg.categories]
        got = veille.latest(env.db, now=AT18, votes=votes, categories=categories)
        self.assertSameShape(got, expected)
        self.assertEqual(got["run"]["status"], "done")
        self.assertEqual(got["run"]["schema"], 2)
        self.assertEqual(got["run"]["items"][0]["vote"], "like")
        self.assertTrue(got["run"]["ideas"][0]["has_prompt"])
        self.assertEqual(got["weather"]["condition"]["key"], "rain")
        self.assertEqual(got["days"], ["2026-11-16"])


if __name__ == "__main__":
    unittest.main()
