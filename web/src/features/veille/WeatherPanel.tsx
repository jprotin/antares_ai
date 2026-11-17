// Météo en grand : dessin du temps, température actuelle, libellé, mini et maxi, pluie,
// vent, puis frise des 12 prochaines heures (défile seule dans son cadre). Ancienne
// ligne météo (sans `condition`) : texte d'origine seul, sans dessin.
import type { VeilleWeather } from "@/types/api";

import {
  degrees,
  formatHour,
  formatTime,
  weatherArt,
  weatherLabel,
} from "./veille";
import { WeatherArt } from "./WeatherArt";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="veille-weather__stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

const percent = (value: number | null | undefined) =>
  typeof value === "number" ? `${Math.round(value)} %` : "–";
const speed = (value: number | null | undefined) =>
  typeof value === "number" ? `${Math.round(value)} km/h` : "–";

export function WeatherPanel({ weather }: { weather: VeilleWeather | null }) {
  if (!weather) {
    return (
      <section
        className="veille-weather veille-weather--empty"
        aria-labelledby="veille-weather"
      >
        <h3 id="veille-weather" className="veille-section-title">
          Météo
        </h3>
        <p className="veille-muted">Météo non relevée pour ce passage</p>
      </section>
    );
  }
  const condition = weather.condition;
  if (!condition) {
    return (
      <section className="veille-weather" aria-labelledby="veille-weather">
        <h3 id="veille-weather" className="veille-section-title">
          Météo
        </h3>
        <p className="veille-weather__legacy">{weather.text}</p>
      </section>
    );
  }
  const art = weatherArt(condition.key, condition.is_day);
  const today = weather.today;
  return (
    <section
      className="veille-weather"
      data-weather={condition.key}
      data-day={condition.is_day ? "true" : "false"}
      aria-labelledby="veille-weather"
    >
      <h3 id="veille-weather" className="veille-section-title">
        Météo
        {weather.label && (
          <span className="veille-weather__place"> · {weather.label}</span>
        )}
      </h3>
      <div className="veille-weather__main">
        <WeatherArt art={art} size="large" />
        <div className="veille-weather__now">
          <p className="veille-weather__temp">
            {degrees(weather.current?.temperature)}
          </p>
          <p className="veille-weather__label">
            {condition.label || weatherLabel(condition.key, condition.is_day)}
          </p>
          {weather.fetched_at && formatTime(weather.fetched_at) && (
            <p className="veille-weather__fetched">
              Relevée à {formatTime(weather.fetched_at)}
            </p>
          )}
        </div>
        <dl className="veille-weather__stats">
          <Stat
            label="Mini / maxi"
            value={`${degrees(today?.min)} / ${degrees(today?.max)}`}
          />
          <Stat label="Pluie" value={percent(today?.rain)} />
          <Stat label="Vent" value={speed(weather.current?.wind)} />
          <Stat label="Vent maxi" value={speed(today?.wind)} />
        </dl>
      </div>
      {weather.hours.length > 0 && (
        <div
          className="veille-hours"
          role="region"
          aria-label="Prochaines heures"
          tabIndex={0}
        >
          <ol className="veille-hours__list">
            {weather.hours.map((hour) => (
              <li key={hour.at} className="veille-hours__item">
                <span className="veille-hours__time">
                  {formatHour(hour.at)}
                </span>
                <WeatherArt
                  art={weatherArt(hour.key, hour.is_day)}
                  size="small"
                />
                <span className="sr-only">
                  {weatherLabel(hour.key, hour.is_day)}
                </span>
                <span className="veille-hours__temp">
                  {degrees(hour.temperature)}
                </span>
                <span className="veille-hours__rain">
                  <span className="sr-only">pluie </span>
                  {percent(hour.rain)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
