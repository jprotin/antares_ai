"""Commande principale (__main__.py) et robustesse de la boucle (jobs.py)."""

import asyncio
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import httpx

import connections
import jobs
import providers
from tasks_testing import Clock, Env, FakeModel, Web, all_feeds, answer_for, config, utc

spec = importlib.util.spec_from_file_location(
    "tasks_main", Path(__file__).with_name("__main__.py")
)
assert spec and spec.loader
tasks_main = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tasks_main)


class Arguments(unittest.TestCase):
    def test_sous_commandes(self):
        self.assertEqual(tasks_main.parse_args([]).command, "serve")
        for command in ("veille", "meteo", "schedule"):
            self.assertEqual(tasks_main.parse_args([command]).command, command)
        args = tasks_main.parse_args(["veille", "--dry-run"])
        self.assertTrue(args.dry_run)

    def test_sous_commande_inconnue(self):
        with mock.patch("sys.stderr"), self.assertRaises(SystemExit) as caught:
            tasks_main.parse_args(["telegram"])
        self.assertEqual(caught.exception.code, 2)


class NeverWritesConnections(unittest.TestCase):
    def test_section_manquante_jamais_reecrite(self):
        path = Path(tempfile.mkdtemp()) / "connections.json"
        path.write_text(json.dumps({"providers": []}))
        before = path.stat().st_mtime_ns
        original = connections.save
        try:
            with mock.patch.object(connections, "CONNECTIONS_PATH", path):
                ctx = tasks_main.build_context(config(), True, httpx.AsyncClient())
                self.assertEqual(
                    ctx.connections_required,
                    {"providers", "rag", "search", "claude", "mcp"},
                )
                with self.assertRaises(RuntimeError):
                    connections.load()
        finally:
            connections.save = original
        self.assertEqual(path.stat().st_mtime_ns, before)


class Robustness(unittest.TestCase):
    def test_exception_dans_une_tache_passage_failed(self):
        env = Env()
        clock = Clock(utc(2026, 11, 16, 12, 0))
        cfg = config()
        ctx = env.context(all_feeds(Web(), cfg), FakeModel(answer_for), clock, cfg)
        ctx.store.init(clock.now())
        with mock.patch.object(ctx.store, "seen", side_effect=RuntimeError("panne")):
            result = asyncio.run(jobs.run_slot(ctx, utc(2026, 11, 16, 12, 0)))
        self.assertEqual(result.record.status, "failed")
        self.assertIn("erreur interne (RuntimeError)", result.record.errors[-1])
        slots = ctx.store.slots_since(utc(2026, 11, 16))
        self.assertEqual(slots[0]["status"], "failed")

    def test_boucle_vivante_apres_exception(self):
        env = Env()
        clock = Clock(utc(2026, 11, 16, 11, 58))
        cfg = config()
        ctx = env.context(all_feeds(Web(), cfg), FakeModel(answer_for), clock, cfg)
        ticks = []
        real_tick = jobs.tick

        async def flaky(c):
            ticks.append(c.now())
            if len(ticks) == 1:
                raise RuntimeError("panne du tour")
            return await real_tick(c)

        ctx.heartbeat = env.dir / "heartbeat"
        with mock.patch.object(jobs, "tick", flaky):
            # Tranches de 10 s : le créneau de 12 h est atteint en une quinzaine de tours
            asyncio.run(jobs.serve(ctx, stop=lambda: len(ticks) >= 15))
        self.assertEqual(len(ticks), 15)
        self.assertTrue(ctx.heartbeat.exists())  # sonde de santé : boucle vivante
        self.assertEqual([r["status"] for r in ctx.store.runs()], ["done"])

    def test_deux_passages_dans_le_meme_processus(self):
        """Vrais `providers` (fournisseur Ollama simulé) : une seule boucle d'événements."""
        env = Env()
        clock = Clock(utc(2026, 11, 16, 12, 0))
        cfg = config()
        ollama_calls = []

        def ollama(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            ollama_calls.append(body)
            return httpx.Response(
                200, json={"message": {"content": answer_for(body["messages"], 2)}}
            )

        url = "http://ollama:11434"
        fake = httpx.AsyncClient(base_url=url, transport=httpx.MockTransport(ollama))
        web = all_feeds(Web(), cfg, "atom_github_releases.xml")
        with (
            mock.patch.object(connections, "CONNECTIONS_PATH", env.connections),
            mock.patch.dict(providers._clients, {(url, ""): fake}),
        ):
            ctx = env.context(web, FakeModel(""), clock, cfg)
            ctx.complete = providers.complete
            ctx.resolve = providers.resolve
            ctx.store.init(clock.now())

            async def twice():
                first = await jobs.run_veille(ctx)
                web.routes.clear()
                all_feeds(web, cfg, "rss_openai.xml")
                clock.advance(hours=5)
                second = await jobs.run_veille(ctx)
                return first, second

            first, second = asyncio.run(twice())
        self.assertEqual((first.record.status, second.record.status), ("done", "done"))
        # Deux passages de deux appels (articles puis idées)
        self.assertEqual(len(ollama_calls), 4)
        self.assertEqual(ollama_calls[0]["model"], "gemma4:e4b")
        self.assertNotIn("num_ctx", json.dumps(ollama_calls[0]["options"]))
        self.assertEqual(ollama_calls[0]["format"], "json")


if __name__ == "__main__":
    unittest.main()
