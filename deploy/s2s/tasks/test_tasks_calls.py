"""Report pendant un appel (calls.py) : horloge et lecteur d'état injectés, sans réseau."""

import asyncio
import unittest

import httpx

import calls
from settings import Call
from tasks_testing import Web

CALL = Call(idle_seconds=120, wait_step_s=60, max_wait_min=15)
T0 = 1_800_000_000.0


class Scenario:
    """Horloge en secondes ; `turns(t)` donne l'heure du dernier tour à l'instant t."""

    def __init__(self, turns):
        self.t = T0
        self.turns = turns

    async def read_at(self):
        return self.turns(self.t)

    def now(self):
        return self.t

    async def sleep(self, seconds):
        self.t += seconds

    def run(self) -> float:
        return asyncio.run(calls.wait_quiet(self.read_at, self.now, self.sleep, CALL))


class Active(unittest.TestCase):
    def test_tour_il_y_a_30s(self):
        self.assertTrue(calls.call_active(T0 - 30, T0, 120))

    def test_tour_il_y_a_3min(self):
        self.assertFalse(calls.call_active(T0 - 180, T0, 120))

    def test_at_zero_ou_injoignable(self):
        self.assertFalse(calls.call_active(0.0, T0, 120))
        self.assertFalse(calls.call_active(None, T0, 120))

    def test_at_dans_le_futur(self):
        self.assertTrue(calls.call_active(T0 + 600, T0, 120))


class WaitQuiet(unittest.TestCase):
    def test_tour_recent_attente_par_minute(self):
        # Dernier tour figé à T0 - 30 s : attentes d'une minute jusqu'à 120 s de calme
        scenario = Scenario(lambda t: T0 - 30)
        self.assertEqual(scenario.run(), 120)

    def test_pas_d_appel(self):
        self.assertEqual(Scenario(lambda t: T0 - 300).run(), 0)

    def test_appel_de_20_min_execution_a_15(self):
        self.assertEqual(
            Scenario(lambda t: t - 5 if t < T0 + 1200 else T0 + 1200).run(), 900
        )

    def test_appel_termine_a_4_min(self):
        waited = Scenario(lambda t: t - 5 if t < T0 + 240 else T0 + 240).run()
        self.assertEqual(waited, 360)  # +4 min, puis 2 min de calme (idle 120 s)

    def test_routeur_injoignable(self):
        self.assertEqual(Scenario(lambda t: None).run(), 0)

    def test_at_futur_borne(self):
        self.assertEqual(Scenario(lambda t: T0 + 10_000).run(), 900)


class ReadLastTurn(unittest.TestCase):
    def read(self, response):
        web = Web().add("http://llm-router:11434/api/turn/last", response)

        async def go():
            async with web.client() as client:
                return await calls.read_last_turn(client, "http://llm-router:11434")

        return asyncio.run(go())

    def test_champ_at(self):
        self.assertEqual(self.read(httpx.Response(200, json={"at": 12.5})), 12.5)
        self.assertEqual(self.read(httpx.Response(200, json={"at": 0.0})), 0.0)

    def test_injoignable(self):
        self.assertIsNone(self.read(httpx.ConnectTimeout("délai")))
        self.assertIsNone(self.read(httpx.Response(502)))
        self.assertIsNone(self.read(httpx.Response(200, content=b"<html>")))


if __name__ == "__main__":
    unittest.main()
