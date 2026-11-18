"""Météo par Open-Meteo (sans clé), mise en forme fixe, sans modèle (cf. spec E).

Règles fixées (et figées par les tests) : valeurs arrondies à l'entier le plus proche
(`round`, jamais « -0 »), espaces ordinaires avant les unités, valeur absente ou non
numérique = « non disponible » dans le texte et `null` dans les données. Exemple de
texte : `Le Pellerin : 6 à 12 °C, pluie 40 %, vent jusqu'à 35 km/h`.

Données enregistrées : {label, text, condition{code, key, label, is_day},
current{temperature, wind}, today{min, max, rain, wind}, hours[{at, temperature, code,
key, rain, is_day}]}. `condition` vient de `current`, sinon du code du jour (de jour).
`hours` : les `weather.hours` heures pleines à partir de l'heure du passage.
"""

import logging
import math
from datetime import datetime
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx

from settings import Weather

logger = logging.getLogger("tasks.weather")

API = "https://api.open-meteo.com/v1/forecast"
DAILY = (
    "weather_code",
    "temperature_2m_min",
    "temperature_2m_max",
    "precipitation_probability_max",
    "wind_speed_10m_max",
)
CURRENT = ("temperature_2m", "weather_code", "is_day", "wind_speed_10m")
HOURLY = ("temperature_2m", "weather_code", "precipitation_probability", "is_day")
NA = "non disponible"
ERROR = "Météo indisponible"

# Codes WMO -> (clé du dessin, libellé)
CONDITIONS: list[tuple[range | tuple[int, ...], str, str]] = [
    ((0,), "clear", "Ensoleillé"),
    ((1, 2), "partly-cloudy", "Éclaircies"),
    ((3,), "cloudy", "Nuageux"),
    ((45, 48), "fog", "Brouillard"),
    (range(51, 58), "drizzle", "Bruine"),
    (range(61, 68), "rain", "Pluie"),
    (range(80, 83), "rain", "Averses"),
    ((*range(71, 78), 85, 86), "snow", "Neige"),
    (range(95, 100), "storm", "Orage"),
]
UNKNOWN = ("unknown", "Temps inconnu")


def build_url(weather: Weather, timezone_name: str) -> str:
    query = urlencode(
        {
            "latitude": weather.latitude,
            "longitude": weather.longitude,
            "daily": ",".join(DAILY),
            "current": ",".join(CURRENT),
            "hourly": ",".join(HOURLY),
            "timezone": timezone_name,
            "forecast_days": 2,
        }
    )
    return f"{API}?{query}"


def _number(value) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return int(round(value)) + 0  # + 0 : jamais « -0 »


def _first(block: dict, key: str) -> int | None:
    values = block.get(key)
    if not isinstance(values, list) or not values:
        return None
    return _number(values[0])


def _section(payload: dict, name: str) -> dict:
    block = payload.get(name) if isinstance(payload, dict) else None
    return block if isinstance(block, dict) else {}


def values(payload: dict) -> dict[str, int | None]:
    daily = _section(payload, "daily")
    return {
        "min": _first(daily, "temperature_2m_min"),
        "max": _first(daily, "temperature_2m_max"),
        "rain": _first(daily, "precipitation_probability_max"),
        "wind": _first(daily, "wind_speed_10m_max"),
    }


def describe(code: int | None, is_day: bool = True) -> tuple[str, str]:
    """(clé du dessin, libellé) d'un code WMO."""
    if code is None:
        return UNKNOWN
    for codes, key, label in CONDITIONS:
        if code in codes:
            if key == "clear" and not is_day:
                return key, "Ciel dégagé"
            return key, label
    return UNKNOWN


def _is_day(value, default: bool = True) -> bool:
    number = _number(value)
    return default if number is None else number != 0


def condition(payload: dict) -> dict | None:
    current = _section(payload, "current")
    code = _number(current.get("weather_code"))
    is_day = _is_day(current.get("is_day"))
    if code is None:
        code = _first(_section(payload, "daily"), "weather_code")
        is_day = True
    if code is None:
        return None
    key, label = describe(code, is_day)
    return {"code": code, "key": key, "label": label, "is_day": is_day}


def hours(payload: dict, now: datetime, tz: ZoneInfo, count: int) -> list[dict]:
    """Les `count` heures pleines à partir de l'heure locale de `now`."""
    hourly = _section(payload, "hourly")
    times = hourly.get("time")
    if not isinstance(times, list) or count <= 0:
        return []
    start = now.astimezone(tz).replace(minute=0, second=0, microsecond=0)

    def column(key: str) -> list:
        found = hourly.get(key)
        return found if isinstance(found, list) else []

    temperatures, codes = column("temperature_2m"), column("weather_code")
    rains, days = column("precipitation_probability"), column("is_day")
    found: list[dict] = []
    for index, raw in enumerate(times):
        try:
            moment = datetime.fromisoformat(str(raw))
        except ValueError:
            continue
        moment = moment.replace(tzinfo=tz) if moment.tzinfo is None else moment
        if moment < start:
            continue
        code = _number(codes[index]) if index < len(codes) else None
        is_day = _is_day(days[index] if index < len(days) else None)
        found.append(
            {
                "at": moment.isoformat(timespec="seconds"),
                "temperature": _number(temperatures[index])
                if index < len(temperatures)
                else None,
                "code": code,
                "key": describe(code, is_day)[0],
                "rain": _number(rains[index]) if index < len(rains) else None,
                "is_day": is_day,
            }
        )
        if len(found) == count:
            break
    return found


def format_weather(label: str, payload: dict) -> str:
    v = values(payload)
    low, high = v["min"], v["max"]
    if low is not None and high is not None:
        temperature = f"{low} à {high} °C"
    elif low is None and high is None:
        temperature = f"température {NA}"
    else:
        temperature = (
            f"mini {NA if low is None else f'{low} °C'}, "
            f"maxi {NA if high is None else f'{high} °C'}"
        )
    rain = f"pluie {NA}" if v["rain"] is None else f"pluie {v['rain']} %"
    wind = f"vent {NA}" if v["wind"] is None else f"vent jusqu'à {v['wind']} km/h"
    return f"{label} : {temperature}, {rain}, {wind}"


def build(label: str, payload: dict, now: datetime, tz: ZoneInfo, count: int) -> dict:
    current = _section(payload, "current")
    return {
        "label": label,
        "text": format_weather(label, payload),
        "condition": condition(payload),
        "current": {
            "temperature": _number(current.get("temperature_2m")),
            "wind": _number(current.get("wind_speed_10m")),
        },
        "today": values(payload),
        "hours": hours(payload, now, tz, count),
    }


async def fetch_weather(
    client: httpx.AsyncClient, weather: Weather, timezone_name: str, now: datetime
) -> tuple[dict | None, str | None]:
    """(données, None) ou (None, « Météo indisponible ») ; jamais d'exception."""
    try:
        response = await client.get(build_url(weather, timezone_name), timeout=10)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("réponse inattendue")
    except Exception as exc:  # météo absente : erreur courte, la veille continue
        reason = str(exc).splitlines()[0][:200] if str(exc) else type(exc).__name__
        logger.warning("Météo indisponible : %s", reason)
        return None, ERROR
    return build(
        weather.label, payload, now, ZoneInfo(timezone_name), weather.hours
    ), None
