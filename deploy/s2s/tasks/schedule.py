"""Créneaux de la veille : heures locales (fuseau de tasks.yaml) recalculées à chaque tour,
changements d'heure compris. Fonctions pures : l'heure courante est un paramètre.

`slot_key` = heure locale avec décalage + tâche, ex. `2026-11-16T13:00+01:00/veille`.
"""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

TASK = "veille"


def _hhmm(value: str) -> time:
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


def day_slots(day: date, slots: list[str], tz: ZoneInfo) -> list[datetime]:
    """Créneaux d'un jour local, en heure locale avec fuseau (une heure inexistante,
    dans le saut de printemps, est décalée par zoneinfo ; 8 h, 13 h et 18 h ne le sont
    jamais)."""
    return [datetime.combine(day, _hhmm(s), tzinfo=tz) for s in sorted(slots)]


def slots_between(
    start: datetime, end: datetime, slots: list[str], tz: ZoneInfo
) -> list[datetime]:
    """Créneaux compris dans [start, end], en heure locale, ordre chronologique."""
    first = start.astimezone(tz).date() - timedelta(days=1)
    last = end.astimezone(tz).date() + timedelta(days=1)
    found: list[datetime] = []
    day = first
    while day <= last:
        found.extend(s for s in day_slots(day, slots, tz) if start <= s <= end)
        day += timedelta(days=1)
    return found


def next_slots(
    now: datetime, slots: list[str], tz: ZoneInfo, count: int = 1
) -> list[datetime]:
    """Les `count` prochains créneaux (heure exacte d'un créneau comprise)."""
    found: list[datetime] = []
    day = now.astimezone(tz).date()
    while len(found) < count:
        found.extend(s for s in day_slots(day, slots, tz) if s >= now)
        day += timedelta(days=1)
    return found[:count]


def next_slot(now: datetime, slots: list[str], tz: ZoneInfo) -> datetime:
    return next_slots(now, slots, tz, 1)[0]


def slot_key(slot: datetime, task: str = TASK) -> str:
    return f"{slot.isoformat(timespec='minutes')}/{task}"


def local_day(moment: datetime, tz: ZoneInfo) -> str:
    return moment.astimezone(tz).date().isoformat()


def describe(slot: datetime) -> str:
    """« 2026-11-17 08:00 (Europe/Paris, +01:00) = 2026-11-17 07:00 UTC »"""
    utc = slot.astimezone(timezone.utc)
    return (
        f"{slot:%Y-%m-%d %H:%M} ({slot.tzinfo}, {slot:%z}) = {utc:%Y-%m-%d %H:%M} UTC"
    )
