"""Surveillance des pages des candidats (watch.py) : empreinte, signalement, erreurs,
redirections contrôlées, aucun modèle, arrêt en archive. Aucun accès réseau : transport
HTTP simulé, résolution DNS remplacée, base de la présidentielle temporaire."""

import asyncio
import gzip
import tempfile
import time
import unittest
from datetime import timedelta
from pathlib import Path

import httpx

import feeds
import jobs
import watch
from tasks_testing import Clock, Env, FakeModel, Web, config, utc

# 2026-11-20 08:00 à Paris (heure d'hiver) : après le passage de 07:30
NOW = utc(2026, 11, 20, 7, 0)
PAGE_A = "https://candidat-a.example.org/programme"
PAGE_B = "https://candidat-b.example.org/actualites"
DNS = {
    "candidat-a.example.org": ["93.184.216.34"],
    "candidat-b.example.org": ["93.184.216.35"],
    "relais.example.org": ["93.184.216.36"],
    "interne.example.org": ["10.0.0.5"],
}
BASE = """---
jeu: {jeu}
archive_apres: {archive}
tours:
  premier: 2027-04-18
  second: 2027-05-02
"""
SURVEILLANCE = """---
pages:
  - url: {a}
    candidat: candidat-a
    ajoutee_le: 2026-11-18
  - url: {b}
    candidat: candidat-b
    ajoutee_le: 2026-11-18
{gel}"""


def html(text: str, token: str = "") -> httpx.Response:
    body = (
        "<!DOCTYPE html><html><head><script>var jeton='" + token + "';</script>"
        "<style>p{color:red}</style></head><body><p>" + text + "</p></body></html>"
    )
    return httpx.Response(200, content=body.encode("utf-8"))


class Surveillance(unittest.TestCase):
    def setUp(self):
        original = feeds.resolve_host

        async def fake(host: str) -> list[str]:
            return DNS.get(host, [])

        feeds.resolve_host = fake
        self.addCleanup(setattr, feeds, "resolve_host", original)
        self.env = Env()
        self.folder = Path(tempfile.mkdtemp())
        self.write_base()
        self.write_pages()
        self.clock = Clock(NOW)
        self.model = FakeModel(AssertionError("aucun modèle pour la surveillance"))
        self.web = Web()

    def write_base(self, jeu: str = "reel", archive: str = "2027-05-02") -> None:
        (self.folder / "base.yaml").write_text(
            BASE.format(jeu=jeu, archive=archive), encoding="utf-8"
        )

    def write_pages(self, gel: bool = True) -> None:
        (self.folder / "surveillance.yaml").write_text(
            SURVEILLANCE.format(
                a=PAGE_A, b=PAGE_B, gel="gelee_le: 2026-11-19\n" if gel else ""
            ),
            encoding="utf-8",
        )

    def context(self) -> jobs.Context:
        ctx = self.env.context(self.web, self.model, self.clock)
        ctx.presidentielle_dir = self.folder
        ctx.store.init(self.clock.now())
        return ctx

    def run_watch(self, **kwargs) -> watch.WatchResult:
        return asyncio.run(watch.run_watch(self.context(), **kwargs))

    def serve_pages(self, a: str = "Programme v1", b: str = "Actualités v1") -> None:
        self.web.routes.clear()
        self.web.add(PAGE_A, html(a))
        self.web.add(PAGE_B, html(b))

    def test_premiere_visite_sans_signalement(self):
        self.serve_pages()
        result = self.run_watch()
        self.assertEqual((result.checked, result.changed), (2, []))
        pages = self.env.store().watched_pages()
        self.assertEqual(sorted(pages), [PAGE_A, PAGE_B])
        self.assertRegex(pages[PAGE_A]["sha256"], r"^[0-9a-f]{64}$")
        self.assertIsNone(pages[PAGE_A]["changed_at"])

    def test_page_modifiee_signalee(self):
        self.serve_pages()
        self.run_watch()
        self.clock.advance(days=1)
        self.serve_pages(a="Programme v2")
        result = self.run_watch()
        self.assertEqual(result.changed, [PAGE_A])
        page = self.env.store().watched_pages()[PAGE_A]
        # Lendemain du premier passage (pause de 2 s entre les deux pages comprise)
        self.assertEqual(page["changed_at"], "2026-11-21T07:00:02+00:00")
        self.assertEqual(page["changes"], 1)
        self.assertIn("nouvelle source à relire", watch.report(result))
        # Rien de publié : aucune écriture hors de la requête GET des pages
        self.assertEqual(self.model.calls, [])
        self.assertEqual(len(self.web.requests), 4)

    def test_page_identique_rien(self):
        self.serve_pages()
        self.run_watch()
        self.clock.advance(days=1)
        # Même texte visible, jeton de script différent : pas de faux signalement
        self.web.routes.clear()
        self.web.add(PAGE_A, html("Programme v1", token="autre"))
        self.web.add(PAGE_B, html("Actualités v1", token="x"))
        result = self.run_watch()
        self.assertEqual(result.changed, [])
        self.assertIsNone(self.env.store().watched_pages()[PAGE_A]["changed_at"])

    def test_erreur_reseau_pas_de_signalement(self):
        self.serve_pages()
        self.run_watch()
        before = self.env.store().watched_pages()
        for failure in (
            httpx.ReadTimeout("délai dépassé"),
            httpx.Response(500),
            httpx.Response(404),
        ):
            with self.subTest(failure=failure):
                self.clock.advance(days=1)
                self.web.routes.clear()
                self.web.add(PAGE_A, failure)
                self.web.add(PAGE_B, html("Actualités v1"))
                result = self.run_watch()
                self.assertEqual(result.changed, [])
                self.assertEqual(len(result.errors), 1)
                page = self.env.store().watched_pages()[PAGE_A]
                self.assertEqual(page["status"], "error")
                self.assertEqual(page["sha256"], before[PAGE_A]["sha256"])
                self.assertIsNone(page["changed_at"])
        # Retour de la page, inchangée : toujours rien
        self.clock.advance(days=1)
        self.serve_pages()
        self.assertEqual(self.run_watch().changed, [])

    def test_page_trop_grande_refusee(self):
        self.serve_pages()
        self.web.routes.clear()
        self.web.add(PAGE_A, httpx.Response(200, content=b"x" * 6_000_000))
        self.web.add(PAGE_B, html("Actualités v1"))
        result = self.run_watch()
        self.assertEqual(len(result.errors), 1)
        self.assertIn("octets", result.errors[0])

    def test_reponse_compressee_bornee(self):
        bomb = gzip.compress(b"a" * 20_000_000)
        self.web.add(
            PAGE_A,
            httpx.Response(
                200,
                stream=httpx.ByteStream(bomb),
                headers={"content-encoding": "gzip"},
            ),
        )
        self.web.add(
            PAGE_B,
            httpx.Response(200, content=b"x", headers={"content-encoding": "br"}),
        )
        result = self.run_watch()
        self.assertEqual(len(result.errors), 2)
        self.assertIn("octets", result.errors[0])
        self.assertIn("encodage refusé", result.errors[1])

    def test_reponse_gzip_lue(self):
        body = b"<!DOCTYPE html><html><body><p>Programme v1</p></body></html>"
        self.web.add(
            PAGE_A,
            # Flux non lu (comme une vraie réponse) : octets bruts compressés
            httpx.Response(
                200,
                stream=httpx.ByteStream(gzip.compress(body)),
                headers={"content-encoding": "gzip"},
            ),
        )
        self.web.add(PAGE_B, html("Actualités v1"))
        self.assertEqual(self.run_watch().errors, [])
        stored = self.env.store().watched_pages()[PAGE_A]["sha256"]
        self.assertEqual(stored, watch.fingerprint(body))

    def test_adresses_internes_deguisees_refusees(self):
        for url in (
            "https://2130706433/",
            "https://0177.0.0.1/",
            "https://localhost./",
            "https://[::ffff:127.0.0.1]/",
            "https://[::1]/",
        ):
            with self.subTest(url=url):
                (self.folder / "surveillance.yaml").write_text(
                    f"---\npages:\n  - url: '{url}'\n    candidat: candidat-a\n"
                    "    ajoutee_le: 2026-11-18\ngelee_le: 2026-11-19\n",
                    encoding="utf-8",
                )
                self.web = Web()
                result = self.run_watch()
                self.assertEqual(len(result.errors), 1, result)
                self.assertEqual(self.web.requests, [])

    def test_redirection_controlee(self):
        for target in (
            "http://candidat-a.example.org/clair",
            "https://interne.example.org/admin",
            "https://127.0.0.1/",
            "https://qdrant:6333/collections",
        ):
            with self.subTest(target=target):
                self.web = Web()
                self.web.add(PAGE_A, httpx.Response(302, headers={"location": target}))
                self.web.add(PAGE_B, html("Actualités v1"))
                result = self.run_watch()
                self.assertEqual(len(result.errors), 1)
                self.assertIn("redirection refusée", result.errors[0])
                # La cible n'est jamais demandée
                self.assertEqual(self.web.hits(target), 0)

    def test_redirection_publique_suivie(self):
        target = "https://relais.example.org/programme"
        self.web.add(PAGE_A, httpx.Response(301, headers={"location": target}))
        self.web.add(target, html("Programme v1"))
        self.web.add(PAGE_B, html("Actualités v1"))
        result = self.run_watch()
        self.assertEqual(result.errors, [])
        self.assertEqual(self.web.hits(target), 1)

    def test_premiere_adresse_controlee(self):
        (self.folder / "surveillance.yaml").write_text(
            "---\npages:\n  - url: https://interne.example.org/x\n"
            "    candidat: candidat-a\n    ajoutee_le: 2026-11-18\n"
            "gelee_le: 2026-11-19\n",
            encoding="utf-8",
        )
        result = self.run_watch()
        self.assertEqual(len(result.errors), 1)
        self.assertEqual(self.web.requests, [])

    def test_aucun_modele_appele(self):
        self.serve_pages()
        ctx = self.context()

        def interdit(*args, **kwargs):
            raise AssertionError("résolution d'un modèle interdite")

        ctx.resolve = interdit
        asyncio.run(watch.run_watch(ctx))
        self.clock.advance(days=1)
        self.serve_pages(a="Programme v2")
        asyncio.run(watch.run_watch(ctx))
        self.assertEqual(self.model.calls, [])

    def test_arret_en_archive(self):
        self.serve_pages()
        self.write_base(archive="2026-11-19")
        result = self.run_watch()
        self.assertIn("archive", result.skipped)
        self.assertEqual(self.web.requests, [])
        # Dernier jour avant l'archive (heure de Paris) : surveillance active
        self.write_base(archive="2026-11-20")
        self.assertEqual(self.run_watch().skipped, "")

    def test_liste_non_gelee_aucune_requete(self):
        self.serve_pages()
        self.write_pages(gel=False)
        result = self.run_watch()
        self.assertIn("non gelée", result.skipped)
        self.assertEqual(self.web.requests, [])

    def test_jeu_de_demonstration_aucune_requete(self):
        self.serve_pages()
        self.write_base(jeu="demonstration")
        result = self.run_watch()
        self.assertIn("démonstration", result.skipped)
        self.assertEqual(self.web.requests, [])

    def test_base_absente_ou_illisible(self):
        (self.folder / "base.yaml").unlink()
        self.assertIn("absente", self.run_watch().skipped)
        (self.folder / "base.yaml").write_text("---\n- x\n", encoding="utf-8")
        self.assertIn("en défaut", self.run_watch().skipped)
        self.assertEqual(self.web.requests, [])

    def test_page_retiree_oubliee(self):
        self.serve_pages()
        self.run_watch()
        (self.folder / "surveillance.yaml").write_text(
            f"---\npages:\n  - url: {PAGE_A}\n    candidat: candidat-a\n"
            "    ajoutee_le: 2026-11-18\ngelee_le: 2026-11-19\n",
            encoding="utf-8",
        )
        self.clock.advance(days=1)
        result = self.run_watch()
        self.assertEqual(result.forgotten, 1)
        self.assertEqual(list(self.env.store().watched_pages()), [PAGE_A])

    def test_essai_a_blanc_sans_ecriture(self):
        self.serve_pages()
        self.run_watch()
        self.clock.advance(days=1)
        self.serve_pages(a="Programme v2")
        result = self.run_watch(dry_run=True)
        self.assertEqual(result.changed, [PAGE_A])
        self.assertIsNone(self.env.store().watched_pages()[PAGE_A]["changed_at"])

    def test_un_passage_par_jour_a_l_heure_dite(self):
        self.serve_pages()
        ctx = self.context()
        # 07:00 à Paris : trop tôt
        self.clock.current = utc(2026, 11, 20, 6, 0)
        self.assertIsNone(asyncio.run(watch.run_due(ctx)))
        self.assertEqual(self.web.requests, [])
        # 08:00 : passage, puis plus rien le même jour (même par un second processus)
        self.clock.current = NOW
        self.assertIsNotNone(asyncio.run(watch.run_due(ctx)))
        self.clock.advance(hours=6)
        self.assertIsNone(asyncio.run(watch.run_due(ctx)))
        self.assertEqual(len(self.web.requests), 2)
        slots = ctx.store.slots_since(NOW - timedelta(days=1))
        self.assertEqual(
            [(s["slot_key"], s["status"]) for s in slots],
            [("2026-11-20T07:30+01:00/presidentielle-watch", "done")],
        )
        # Lendemain : nouveau passage
        self.clock.advance(days=1)
        self.assertIsNotNone(asyncio.run(watch.run_due(ctx)))

    def test_rapport_schedule_ignore_la_surveillance(self):
        ctx = self.context()
        key = "2026-11-20T07:30+01:00/presidentielle-watch"
        ctx.store.take_slot(key, watch.TASK, "2026-11-20", NOW, NOW)
        ctx.store.finish_slot(key, "failed", NOW)
        self.assertIn("Créneaux manqués (24 h) : aucun", jobs.schedule_report(ctx))

    def test_desactivee(self):
        cfg = config()
        cfg = cfg.model_copy(
            update={
                "presidentielle_watch": cfg.presidentielle_watch.model_copy(
                    update={"enabled": False}
                )
            }
        )
        ctx = self.env.context(self.web, self.model, self.clock, cfg=cfg)
        ctx.presidentielle_dir = self.folder
        ctx.store.init(NOW)
        self.assertIsNone(asyncio.run(watch.run_due(ctx)))
        ctx.presidentielle_dir = None
        self.assertIsNone(asyncio.run(watch.run_due(ctx)))
        self.assertEqual(self.web.requests, [])

    def test_boucle_planifiee_lance_la_surveillance(self):
        self.serve_pages()
        ctx = self.context()
        for feed in ctx.config.feeds:
            self.web.add(feed.url, httpx.Response(500))
        turns = iter([False, True])
        asyncio.run(jobs.serve(ctx, stop=lambda: next(turns)))
        self.assertEqual(self.web.hits(PAGE_A), 1)
        self.assertEqual(self.model.calls, [])


class Empreinte(unittest.TestCase):
    def test_page_piegee_en_temps_lineaire(self):
        for piege in (
            b"<html>" + b"<script>" * 200_000,
            b"<html>" + b"<" * 1_000_000,
            b"<html>" + b"<style a='" * 100_000,
        ):
            with self.subTest(taille=len(piege)):
                start = time.monotonic()
                watch.fingerprint(piege)
                self.assertLess(time.monotonic() - start, 3.0)

    def test_html_texte_visible(self):
        a = b"<html><body><p>Texte</p><script>x=1</script></body></html>"
        b = b"<html><body>\n<p>Texte</p><script>x=2</script></body></html>"
        self.assertEqual(watch.fingerprint(a), watch.fingerprint(b))
        self.assertNotEqual(
            watch.fingerprint(a), watch.fingerprint(a.replace(b"Texte", b"Autre"))
        )

    def test_document_octets(self):
        self.assertNotEqual(watch.fingerprint(b"%PDF-1"), watch.fingerprint(b"%PDF-2"))


if __name__ == "__main__":
    unittest.main()
