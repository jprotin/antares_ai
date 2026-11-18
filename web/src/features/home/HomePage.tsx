// Accueil : tableau de bord. Météo en grand, assistant (appel en un clic), top 5 du jour
// et de la semaine, idées du jour, dernière répétition. Données déjà servies par le
// routeur (veille, répétitions) : aucune route propre.
import {
  ArrowRight,
  Lightbulb,
  Mic,
  Newspaper,
  PhoneOff,
  Presentation,
  TrendingUp,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import { avatar, engine } from "@/app/runtime";
import { hrefOf } from "@/app/router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { netLabel } from "@/engines/net/netMonitor";
import { rehearsal } from "@/features/rehearsal";
import {
  categoryLabel,
  degrees,
  formatDay,
  formatTime,
  parseDay,
  safeHref,
  weatherArt,
  weatherLabel,
  useVeillePolling,
  veilleStore,
  WeatherArt,
} from "@/features/veille";
import { getJson } from "@/lib/api";
import { modelLabel } from "@/lib/labels";
import { useAppStore } from "@/state/hooks";
import { currentVoice } from "@/state/slices/profile";
import type {
  VeilleCategory,
  VeilleItem,
  VeilleRun,
  VeilleWeather,
} from "@/types/api";

import { dayTop, TOP, WEEK_DAYS, weekTop } from "./home";

async function loadRuns(day: string): Promise<VeilleRun[]> {
  try {
    const parsed = parseDay(
      await getJson(`api/veille?date=${encodeURIComponent(day)}`),
    );
    return parsed?.runs ?? [];
  } catch {
    return [];
  }
}

// Passages des derniers jours (le plus récent d'abord), relus à chaque nouveau passage
function useRecentRuns(): VeilleRun[][] | null {
  const days = useStore(veilleStore, (s) =>
    (s.latest?.days ?? []).slice(0, WEEK_DAYS).join(","),
  );
  const stamp = useStore(veilleStore, (s) => s.latest?.run?.finished_at);
  const [runs, setRuns] = useState<VeilleRun[][] | null>(null);
  useEffect(() => {
    if (!days) return;
    let alive = true;
    void Promise.all(days.split(",").map(loadRuns)).then((loaded) => {
      if (alive) setRuns(loaded);
    });
    return () => {
      alive = false;
    };
  }, [days, stamp]);
  return days ? runs : [];
}

function WeatherCard({
  weather,
  className,
}: {
  weather: VeilleWeather | null | undefined;
  className?: string;
}) {
  const condition = weather?.condition;
  return (
    <Card className={className} data-testid="home-weather">
      <CardHeader>
        <CardTitle>Météo</CardTitle>
        <CardDescription>
          {weather?.label ?? "Relevée avec la veille"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 items-center gap-6">
        {weather === undefined && <Skeleton className="h-28 w-full" />}
        {weather === null && (
          <p className="text-muted-foreground">Météo pas encore relevée.</p>
        )}
        {weather && !condition && <p>{weather.text}</p>}
        {weather && condition && (
          <>
            <WeatherArt
              art={weatherArt(condition.key, condition.is_day)}
              size="large"
            />
            <div className="min-w-0">
              <p className="text-5xl font-semibold tracking-tight">
                {degrees(weather.current?.temperature)}
              </p>
              <p className="mt-1 text-lg">
                {condition.label ||
                  weatherLabel(condition.key, condition.is_day)}
              </p>
              <p className="mt-1 text-muted-foreground">
                Mini {degrees(weather.today?.min)} · maxi{" "}
                {degrees(weather.today?.max)}
              </p>
            </div>
          </>
        )}
      </CardContent>
      {weather?.fetched_at && formatTime(weather.fetched_at) && (
        <CardFooter className="text-muted-foreground">
          Relevée à {formatTime(weather.fetched_at)}
        </CardFooter>
      )}
    </Card>
  );
}

// Avatar de l'assistant (le même que sur la scène d'appel) : il quitte la scène le temps
// de l'accueil. Le canvas garde la classe .orb de la scène : hauteur minimale et largeur
// maximale levées pour remplir le cadre
function AssistantAvatar() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => (host.current ? avatar.mount(host.current) : undefined), []);
  return (
    <div
      ref={host}
      data-testid="home-avatar"
      className="h-44 w-full overflow-hidden rounded-lg bg-muted [&_canvas]:block [&_canvas]:size-full [&_canvas]:min-h-0 [&_canvas]:max-w-none"
    />
  );
}

function AssistantCard() {
  const name = useAppStore((state) => currentVoice(state)?.name ?? "Antares");
  const model = useAppStore((state) => state.settings?.model);
  const net = useAppStore((state) => state.net);
  const callState = useAppStore((state) => state.callState);
  const status = useAppStore((state) => state.status);
  const idle = callState === "idle" || callState === "connecting";
  return (
    <Card data-testid="home-assistant">
      <CardHeader>
        <CardTitle>{name}</CardTitle>
        <CardDescription>{status}</CardDescription>
        <CardAction>
          <Badge variant={net?.online === false ? "destructive" : "secondary"}>
            {net ? netLabel(net) : "…"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <AssistantAvatar />
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Modèle</dt>
          <dd className="truncate">{modelLabel(model)}</dd>
        </dl>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          variant={idle ? "default" : "destructive"}
          disabled={callState === "connecting"}
          onClick={() => engine.toggle()}
        >
          {idle ? <Mic /> : <PhoneOff />}
          {idle ? "Appeler" : "Raccrocher"}
        </Button>
        <Button variant="outline" asChild>
          <a href={hrefOf("conversation")}>Conversation</a>
        </Button>
      </CardFooter>
    </Card>
  );
}

function ArticleList({
  items,
  categories,
}: {
  items: VeilleItem[];
  categories: VeilleCategory[];
}) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item, position) => {
        const href = safeHref(item.url);
        return (
          <li key={item.id ?? item.url} className="flex gap-3">
            <span className="w-4 shrink-0 text-right font-semibold text-muted-foreground tabular-nums">
              {position + 1}
            </span>
            <div className="min-w-0">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {item.title}
                </a>
              ) : (
                <span className="font-medium">{item.title}</span>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                <span className="truncate">{item.source}</span>
                {item.category && (
                  <Badge variant="outline">
                    {categoryLabel(item.category, categories)}
                  </Badge>
                )}
                {item.vote === "like" && (
                  <Badge variant="secondary">Aimé</Badge>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ListCard({
  title,
  description,
  icon,
  testId,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
      <CardFooter>
        <Button variant="link" className="px-0" asChild>
          <a href={hrefOf("actualites")}>
            Toutes les actualités
            <ArrowRight />
          </a>
        </Button>
      </CardFooter>
    </Card>
  );
}

const Loading = () => (
  <div className="flex flex-col gap-3">
    {Array.from({ length: 3 }, (_, i) => (
      <Skeleton key={i} className="h-10 w-full" />
    ))}
  </div>
);

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="text-muted-foreground">{children}</p>
);

function RehearsalCard() {
  const history = useStore(rehearsal.view, (state) => state.setup.history);
  useEffect(() => {
    void rehearsal.loadSetup();
  }, []);
  const last = history[0];
  return (
    <Card data-testid="home-rehearsal">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Presentation className="size-4" />
          Dernière répétition
        </CardTitle>
        <CardDescription>
          {last
            ? new Date(last.created * 1000).toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "long",
              })
            : "Aucune pour l'instant"}
        </CardDescription>
        {last && last.score !== null && (
          <CardAction>
            <Badge>{last.score} / 20</Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex-1">
        {last ? (
          <p className="font-medium">{last.title}</p>
        ) : (
          <Empty>Préparez une présentation et répétez-la devant l'IA.</Empty>
        )}
      </CardContent>
      <CardFooter>
        <Button variant="outline" asChild>
          <a href={hrefOf("repetition")}>
            {last ? "Répéter à nouveau" : "Préparer une répétition"}
          </a>
        </Button>
      </CardFooter>
    </Card>
  );
}

export function HomePage() {
  useVeillePolling();
  const latest = useStore(veilleStore, (s) => s.latest);
  const recent = useRecentRuns();
  const categories = latest?.categories ?? [];
  // Jour du dernier passage illisible : ce passage seul (comme la page Actualités)
  const today = recent?.[0]?.length
    ? recent[0]
    : latest?.run
      ? [latest.run]
      : [];
  const todayTop = dayTop(today);
  const week = recent ? weekTop(recent) : [];
  const ideas = today
    .flatMap((run) => run.ideas)
    .filter((idea, i, all) => all.findIndex((x) => x.id === idea.id) === i)
    .slice(0, 3);
  const firstDay = latest?.days[0];
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <header>
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Accueil</h1>
        <p className="mt-1 text-muted-foreground">
          {firstDay
            ? `Veille du ${formatDay(firstDay)}`
            : "La veille arrive à 8 h, 13 h et 18 h."}
        </p>
      </header>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <WeatherCard
          className="md:col-span-2"
          weather={latest === null ? undefined : latest.weather}
        />
        <AssistantCard />
        <ListCard
          title={`Top ${TOP} du jour`}
          description="À la une, vos coups de cœur en tête"
          icon={<Newspaper className="size-4" />}
          testId="home-top-day"
        >
          {recent === null && <Loading />}
          {recent && todayTop.length === 0 && (
            <Empty>Pas encore d'actualité aujourd'hui.</Empty>
          )}
          {todayTop.length > 0 && (
            <ArticleList items={todayTop} categories={categories} />
          )}
        </ListCard>
        <ListCard
          title={`Top ${TOP} de la semaine`}
          description={`Articles aimés et à la une des ${WEEK_DAYS} derniers jours`}
          icon={<TrendingUp className="size-4" />}
          testId="home-top-week"
        >
          {recent === null && <Loading />}
          {recent && week.length === 0 && (
            <Empty>Pas encore d'actualité cette semaine.</Empty>
          )}
          {week.length > 0 && (
            <ArticleList items={week} categories={categories} />
          )}
        </ListCard>
        <Card data-testid="home-ideas">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="size-4" />
              Idées du jour
            </CardTitle>
            <CardDescription>Pistes tirées de la veille</CardDescription>
          </CardHeader>
          <CardContent className="flex-1">
            {recent === null && <Loading />}
            {recent && ideas.length === 0 && (
              <Empty>Pas d'idée aujourd'hui.</Empty>
            )}
            <ul className="flex flex-col gap-3">
              {ideas.map((idea) => (
                <li key={idea.id ?? idea.title}>
                  <p className="font-medium">{idea.title}</p>
                  <p className="mt-1 text-muted-foreground">{idea.benefit}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <RehearsalCard />
      </div>
    </div>
  );
}
