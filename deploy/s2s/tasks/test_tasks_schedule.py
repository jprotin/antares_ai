"""Créneaux (schedule.py) : prochain créneau, changements d'heure, clés stables."""

import unittest
from datetime import timedelta
from zoneinfo import ZoneInfo

import schedule
from tasks_testing import utc

PARIS = ZoneInfo("Europe/Paris")
SLOTS = ["08:00", "13:00", "18:00"]


class NextSlot(unittest.TestCase):
    def test_matin_vers_13h(self):
        self.assertEqual(
            schedule.next_slot(utc(2026, 11, 16, 9), SLOTS, PARIS),
            utc(2026, 11, 16, 12),
        )

    def test_fin_de_journee_lendemain_8h(self):
        self.assertEqual(
            schedule.next_slot(utc(2026, 11, 16, 17, 30), SLOTS, PARIS),
            utc(2026, 11, 17, 7),
        )

    def test_heure_exacte(self):
        self.assertEqual(
            schedule.next_slot(utc(2026, 11, 16, 12), SLOTS, PARIS),
            utc(2026, 11, 16, 12),
        )

    def test_passage_heure_ete(self):
        self.assertEqual(
            schedule.next_slot(utc(2026, 3, 28, 18), SLOTS, PARIS), utc(2026, 3, 29, 6)
        )

    def test_passage_heure_hiver(self):
        self.assertEqual(
            schedule.next_slot(utc(2026, 10, 24, 17), SLOTS, PARIS),
            utc(2026, 10, 25, 7),
        )

    def test_jours_de_changement_trois_creneaux(self):
        for day, expected in (
            ((2026, 3, 29), [6, 11, 16]),
            ((2026, 10, 25), [7, 12, 17]),
        ):
            start = utc(*day, 0) - timedelta(hours=2)
            found = schedule.slots_between(
                start, start + timedelta(hours=24), SLOTS, PARIS
            )
            self.assertEqual(
                [s.astimezone(utc(2026, 1, 1).tzinfo).hour for s in found], expected
            )

    def test_trois_prochains(self):
        found = schedule.next_slots(utc(2026, 11, 16, 12, 30), SLOTS, PARIS, 3)
        self.assertEqual(
            found, [utc(2026, 11, 16, 17), utc(2026, 11, 17, 7), utc(2026, 11, 17, 12)]
        )

    def test_autre_fuseau(self):
        ny = ZoneInfo("America/New_York")
        self.assertEqual(
            schedule.next_slot(utc(2026, 11, 16, 12), SLOTS, ny), utc(2026, 11, 16, 13)
        )


class Keys(unittest.TestCase):
    def test_decalage_ete_hiver(self):
        summer = schedule.next_slot(utc(2026, 7, 1, 0), SLOTS, PARIS)
        winter = schedule.next_slot(utc(2026, 11, 16, 0), SLOTS, PARIS)
        self.assertEqual(schedule.slot_key(summer), "2026-07-01T08:00+02:00/veille")
        self.assertEqual(schedule.slot_key(winter), "2026-11-16T08:00+01:00/veille")

    def test_cle_stable(self):
        a = schedule.next_slot(utc(2026, 11, 16, 9), SLOTS, PARIS)
        b = schedule.next_slot(utc(2026, 11, 16, 11, 59), SLOTS, PARIS)
        self.assertEqual(schedule.slot_key(a), schedule.slot_key(b))

    def test_jour_local(self):
        # 00 h 30 à Paris = veille en UTC
        self.assertEqual(
            schedule.local_day(utc(2026, 11, 15, 23, 30), PARIS), "2026-11-16"
        )

    def test_describe(self):
        text = schedule.describe(schedule.next_slot(utc(2026, 11, 16, 9), SLOTS, PARIS))
        self.assertEqual(
            text, "2026-11-16 13:00 (Europe/Paris, +0100) = 2026-11-16 12:00 UTC"
        )


if __name__ == "__main__":
    unittest.main()
