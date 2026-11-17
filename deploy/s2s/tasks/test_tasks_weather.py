"""Météo (weather.py) : mise en forme fixe et erreurs courtes, sans réseau."""

import asyncio
import json
import unittest
from urllib.parse import parse_qs, urlsplit

import httpx

import weather
from tasks_testing import Web, config, fixture, utc

PARIS = config().tz
# 2026-11-16 13:00 à Paris (passage de 13 h)
AT13 = utc(2026, 11, 16, 12, 0)

LABEL = "Le Pellerin"


def daily(tmin, tmax, rain, wind) -> dict:
    return {
        "daily": {
            "temperature_2m_min": [tmin],
            "temperature_2m_max": [tmax],
            "precipitation_probability_max": [rain],
            "wind_speed_10m_max": [wind],
        }
    }


class Format(unittest.TestCase):
    def test_nominal(self):
        payload = json.loads(fixture("open_meteo.json"))
        self.assertEqual(
            weather.format_weather(LABEL, payload),
            "Le Pellerin : 6 à 12 °C, pluie 40 %, vent jusqu'à 35 km/h",
        )

    def test_arrondi(self):
        self.assertEqual(
            weather.format_weather(LABEL, daily(5.6, 12.4, 39.5, 35.7)),
            "Le Pellerin : 6 à 12 °C, pluie 40 %, vent jusqu'à 36 km/h",
        )

    def test_zero_affiche_zero(self):
        self.assertEqual(
            weather.format_weather(LABEL, daily(0, 0.0, 0, 0)),
            "Le Pellerin : 0 à 0 °C, pluie 0 %, vent jusqu'à 0 km/h",
        )

    def test_negatives_et_moins_zero(self):
        self.assertEqual(
            weather.format_weather(LABEL, daily(-3, 2, 10, 5)),
            "Le Pellerin : -3 à 2 °C, pluie 10 %, vent jusqu'à 5 km/h",
        )
        self.assertIn(" 0 à ", weather.format_weather(LABEL, daily(-0.4, 3, 1, 1)))

    def test_valeur_nulle(self):
        payload = json.loads(fixture("open_meteo_nulls.json"))
        self.assertEqual(
            weather.format_weather(LABEL, payload),
            "Le Pellerin : -3 à 0 °C, pluie non disponible, vent jusqu'à 0 km/h",
        )

    def test_une_temperature_absente(self):
        self.assertEqual(
            weather.format_weather(LABEL, daily(None, 12, 40, 35)),
            "Le Pellerin : mini non disponible, maxi 12 °C, pluie 40 %, vent jusqu'à 35 km/h",
        )

    def test_daily_absent_ou_vide(self):
        expected = (
            "Le Pellerin : température non disponible, pluie non disponible, "
            "vent non disponible"
        )
        for payload in (
            {},
            {"daily": {}},
            {"daily": {"temperature_2m_min": []}},
            {"daily": None},
        ):
            text = weather.format_weather(LABEL, payload)
            self.assertEqual(text, expected)
            self.assertNotIn("None", text)
            self.assertNotIn("nan", text)

    def test_valeurs_non_numeriques(self):
        text = weather.format_weather(LABEL, daily("6", True, float("nan"), None))
        self.assertNotIn("nan", text)
        self.assertNotIn("True", text)


class Conditions(unittest.TestCase):
    def test_table_des_codes(self):
        cases = {
            0: ("clear", "Ensoleillé"),
            1: ("partly-cloudy", "Éclaircies"),
            2: ("partly-cloudy", "Éclaircies"),
            3: ("cloudy", "Nuageux"),
            45: ("fog", "Brouillard"),
            48: ("fog", "Brouillard"),
            51: ("drizzle", "Bruine"),
            57: ("drizzle", "Bruine"),
            61: ("rain", "Pluie"),
            67: ("rain", "Pluie"),
            80: ("rain", "Averses"),
            82: ("rain", "Averses"),
            71: ("snow", "Neige"),
            77: ("snow", "Neige"),
            85: ("snow", "Neige"),
            86: ("snow", "Neige"),
            95: ("storm", "Orage"),
            99: ("storm", "Orage"),
            4: ("unknown", "Temps inconnu"),
            100: ("unknown", "Temps inconnu"),
        }
        for code, expected in cases.items():
            self.assertEqual(weather.describe(code), expected, code)
        self.assertEqual(weather.describe(None), ("unknown", "Temps inconnu"))

    def test_nuit(self):
        self.assertEqual(weather.describe(0, is_day=False), ("clear", "Ciel dégagé"))
        self.assertEqual(weather.describe(2, is_day=False)[0], "partly-cloudy")

    def test_code_61_de_jour(self):
        payload = {"current": {"weather_code": 61, "is_day": 1}}
        self.assertEqual(
            weather.condition(payload),
            {"code": 61, "key": "rain", "label": "Pluie", "is_day": True},
        )

    def test_repli_sur_le_code_du_jour(self):
        payload = {"current": {}, "daily": {"weather_code": [3]}}
        self.assertEqual(weather.condition(payload)["key"], "cloudy")
        self.assertIsNone(weather.condition({}))


class Build(unittest.TestCase):
    def test_forme_complete(self):
        payload = json.loads(fixture("open_meteo.json"))
        data = weather.build(LABEL, payload, AT13, PARIS, 12)
        self.assertEqual(
            set(data), {"label", "text", "condition", "current", "today", "hours"}
        )
        self.assertEqual(
            data["text"], "Le Pellerin : 6 à 12 °C, pluie 40 %, vent jusqu'à 35 km/h"
        )
        self.assertEqual(data["condition"]["key"], "rain")
        self.assertEqual(data["current"], {"temperature": 10, "wind": 22})
        self.assertEqual(data["today"], {"min": 6, "max": 12, "rain": 40, "wind": 35})
        hours = data["hours"]
        self.assertEqual(len(hours), 12)
        self.assertEqual(hours[0]["at"], "2026-11-16T13:00:00+01:00")
        self.assertEqual(hours[-1]["at"], "2026-11-17T00:00:00+01:00")
        self.assertEqual(
            hours[0],
            {
                "at": "2026-11-16T13:00:00+01:00",
                "temperature": 12,
                "code": 61,
                "key": "rain",
                "rain": 70,
                "is_day": True,
            },
        )
        self.assertFalse(hours[-1]["is_day"])

    def test_passage_du_soir(self):
        payload = json.loads(fixture("open_meteo.json"))
        hours = weather.hours(payload, utc(2026, 11, 16, 17, 2), PARIS, 12)
        self.assertEqual(hours[0]["at"], "2026-11-16T18:00:00+01:00")

    def test_donnees_absentes(self):
        data = weather.build(LABEL, {}, AT13, PARIS, 12)
        self.assertIsNone(data["condition"])
        self.assertEqual(data["hours"], [])
        self.assertEqual(data["current"], {"temperature": None, "wind": None})
        payload = {"hourly": {"time": ["2026-11-16T14:00", "x"], "weather_code": []}}
        self.assertEqual(
            weather.hours(payload, AT13, PARIS, 12),
            [
                {
                    "at": "2026-11-16T14:00:00+01:00",
                    "temperature": None,
                    "code": None,
                    "key": "unknown",
                    "rain": None,
                    "is_day": True,
                }
            ],
        )


class Url(unittest.TestCase):
    def test_parametres(self):
        cfg = config()
        query = parse_qs(urlsplit(weather.build_url(cfg.weather, cfg.timezone)).query)
        self.assertEqual(
            query["daily"][0].split(","),
            [
                "weather_code",
                "temperature_2m_min",
                "temperature_2m_max",
                "precipitation_probability_max",
                "wind_speed_10m_max",
            ],
        )
        self.assertEqual(
            query["current"][0].split(","),
            ["temperature_2m", "weather_code", "is_day", "wind_speed_10m"],
        )
        self.assertEqual(
            query["hourly"][0].split(","),
            ["temperature_2m", "weather_code", "precipitation_probability", "is_day"],
        )
        self.assertEqual(query["timezone"], ["Europe/Paris"])
        self.assertEqual(query["forecast_days"], ["2"])
        self.assertEqual(query["latitude"], ["47.2"])
        self.assertEqual(query["longitude"], ["-1.75"])


def fetch(response) -> tuple:
    cfg = config()
    web = Web().add(weather.API, response)

    async def go():
        async with web.client() as client:
            return await weather.fetch_weather(client, cfg.weather, cfg.timezone, AT13)

    return asyncio.run(go())


class Fetch(unittest.TestCase):
    def test_reponse_enregistree(self):
        data, error = fetch(httpx.Response(200, content=fixture("open_meteo.json")))
        self.assertIsNone(error)
        self.assertEqual(
            data["text"], "Le Pellerin : 6 à 12 °C, pluie 40 %, vent jusqu'à 35 km/h"
        )
        self.assertEqual(data["today"], {"min": 6, "max": 12, "rain": 40, "wind": 35})
        self.assertEqual(data["label"], "Le Pellerin")
        self.assertEqual(len(data["hours"]), 12)

    def test_erreurs_courtes_sans_exception(self):
        for response in (
            httpx.Response(500),
            httpx.ReadTimeout("délai"),
            httpx.Response(200, content=b"pas du json"),
            httpx.Response(200, content=b"[1, 2]"),
        ):
            self.assertEqual(fetch(response), (None, "Météo indisponible"))


if __name__ == "__main__":
    unittest.main()
