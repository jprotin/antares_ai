"""Réglages (settings.py) : python -m unittest test_tasks_settings (dans l'image, cf. README)."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from settings import ConfigError, load_config
from tasks_testing import DEFAULT_CONFIG

GOOD = DEFAULT_CONFIG.read_text(encoding="utf-8")


def write(text: str) -> Path:
    path = Path(tempfile.mkdtemp()) / "tasks.yaml"
    path.write_text(text, encoding="utf-8")
    return path


class LoadConfig(unittest.TestCase):
    def test_fichier_livre_valide(self):
        config = load_config(DEFAULT_CONFIG)
        self.assertEqual(config.slots, ["08:00", "13:00", "18:00"])
        self.assertEqual(config.timezone, "Europe/Paris")
        self.assertEqual(config.model, "")
        self.assertEqual(config.weather.label, "Le Pellerin")
        self.assertEqual(config.limits.candidates, 90)
        self.assertEqual(config.limits.candidates_per_category, 5)
        self.assertEqual(config.limits.summary_chars, 200)
        self.assertEqual(config.max_tokens, 6000)
        self.assertEqual(config.idea_similarity, 0.8)
        self.assertEqual(len(config.feeds), 65)
        self.assertEqual(
            [f.name for f in config.feeds if f.filter_keywords],
            [
                "Les Numériques",
                "Hacker News",
                "Clubic",
                "Journal du Geek",
                "Presse-citron",
                "Wired",
            ],
        )
        self.assertEqual(
            config.category_slugs,
            ["ia", "cloud", "dev", "securite", "materiel", "informatique"],
        )
        self.assertEqual(config.categories[-1].label, "Monde de l'informatique")
        self.assertEqual(
            (config.digest.items_target, config.digest.max_per_source), (30, 4)
        )
        self.assertEqual(
            (config.digest.ideas_requested, config.digest.ideas_kept), (8, 6)
        )
        self.assertEqual(config.learning.half_life_days, 30)
        self.assertTrue(config.weather.every_run)
        self.assertEqual(config.weather.hours, 12)
        self.assertTrue(config.idea_prompt.constraints)
        self.assertTrue(config.idea_prompt.project_map)

    def test_flux_varies(self):
        feeds = load_config(DEFAULT_CONFIG).feeds
        self.assertEqual(len({f.url for f in feeds}), len(feeds))
        self.assertGreaterEqual(sum(1 for f in feeds if f.lang == "fr"), 10)
        for slug in ("ia", "cloud", "dev", "securite", "materiel", "informatique"):
            self.assertTrue(any(f.category == slug for f in feeds), slug)

    def test_adresses_des_flux_du_plan(self):
        urls = {f.url for f in load_config(DEFAULT_CONFIG).feeds}
        for url in (
            "https://openai.com/news/rss.xml",
            "https://blog.google/technology/ai/rss/",
            "https://deepmind.google/blog/rss.xml",
            "https://huggingface.co/blog/feed.xml",
            "https://github.blog/changelog/feed/",
            "https://github.com/anthropics/claude-code/releases.atom",
            "https://github.com/anthropics/anthropic-sdk-python/releases.atom",
            "https://github.com/mistralai/client-python/releases.atom",
            "https://github.com/BerriAI/litellm/releases.atom",
            "https://github.com/n8n-io/n8n/releases.atom",
            "https://github.com/ollama/ollama/releases.atom",
            "https://news.ycombinator.com/rss",
            "https://aws.amazon.com/blogs/aws/feed/",
            "https://cloudblog.withgoogle.com/rss/",
            "https://www.lemondeinformatique.fr/flux-rss/thematique/toutes-les-actualites/rss.xml",
            "https://www.tomshardware.com/feeds.xml",
        ):
            self.assertIn(url, urls)

    def assertRefused(self, text: str, fragment: str):
        with self.assertRaises(ConfigError) as caught:
            load_config(write(text))
        message = str(caught.exception)
        self.assertIn(fragment, message)
        self.assertNotIn("\n", message)
        self.assertNotIn("Traceback", message)

    def test_horaire_invalide(self):
        self.assertRefused(GOOD.replace('"13:00"', '"25:00"'), "25:00")

    def test_fuseau_inconnu(self):
        self.assertRefused(
            GOOD.replace("timezone: Europe/Paris", "timezone: Mars/Olympus"),
            "fuseau inconnu",
        )

    def test_modele_claude_refuse(self):
        self.assertRefused(GOOD.replace('model: ""', 'model: "claude:opus"'), "Claude")

    def test_flux_ftp_refuse(self):
        self.assertRefused(
            GOOD.replace("https://openai.com/news/rss.xml", "ftp://openai.com/rss"),
            "http(s)",
        )

    def test_flux_sans_url(self):
        self.assertRefused(
            GOOD.replace("    url: https://openai.com/news/rss.xml\n", ""), "url"
        )

    def test_cle_inconnue_refusee(self):
        self.assertRefused(GOOD + "\ntelegram: oui\n", "telegram")

    def test_yaml_invalide(self):
        self.assertRefused("slots: [08:00\n", "YAML invalide")

    def test_fichier_absent(self):
        with self.assertRaises(ConfigError):
            load_config(Path("/nonexistent/tasks.yaml"))

    def test_categorie_de_flux_inconnue(self):
        self.assertRefused(
            GOOD.replace("    category: securite\n", "    category: sport\n", 1),
            "catégorie inconnue",
        )

    def test_langue_inconnue(self):
        self.assertRefused(GOOD.replace("    lang: fr\n", "    lang: de\n", 1), "lang")

    def test_modele_claude_refuse_pour_les_prompts(self):
        text = GOOD.replace(
            '  model: ""\n  timeout_s', '  model: "claude:opus"\n  timeout_s'
        )
        self.assertNotEqual(text, GOOD)
        self.assertRefused(text, "Claude")

    def test_ancien_reglage_meteo_refuse(self):
        self.assertRefused(
            GOOD.replace("  every_run: true\n", '  slot: "08:00"\n'), "slot"
        )

    def test_tasks_config_respectee_et_message_sans_trace(self):
        path = write(GOOD.replace('"13:00"', '"25:00"'))
        env = {**os.environ, "TASKS_CONFIG": str(path)}
        main = Path(__file__).with_name("__main__.py")
        done = subprocess.run(
            [sys.executable, str(main), "schedule"],
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(done.returncode, 2)
        self.assertIn("Configuration invalide", done.stderr)
        self.assertIn("25:00", done.stderr)
        self.assertNotIn("Traceback", done.stderr)


if __name__ == "__main__":
    unittest.main()
