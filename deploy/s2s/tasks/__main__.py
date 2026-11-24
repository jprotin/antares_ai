"""Service antares-tasks : veille informatique et météo planifiées, ou lancées à la main.

    python /app/__main__.py [serve]           boucle planifiée (défaut du conteneur)
    python /app/__main__.py veille [--dry-run] une veille maintenant (sans créneau)
    python /app/__main__.py meteo  [--dry-run] la météo du jour
    python /app/__main__.py schedule           prochains passages, dernier succès, manqués
    python /app/__main__.py presidentielle-watch [--dry-run]
                                               surveillance des pages des candidats
                                               maintenant (sans créneau, cf. watch.py)

Avec Docker : `docker compose run --rm antares-tasks veille` (toujours une sous-commande :
sans argument, `run` ouvrirait une seconde boucle planifiée). `--dry-run` affiche le
résultat sans rien enregistrer.
"""

import argparse
import asyncio
import logging
import sys
from pathlib import Path

import httpx

import calls
import connections
import feeds
import jobs
import providers
import settings
import watch
from settings import Config, ConfigError, load_config
from store import Store

LOG_FORMAT = "%(asctime)s - tasks - %(levelname)s - %(message)s"
# Touché à chaque tour de la boucle planifiée ; lu par la sonde de santé (compose.yaml)
HEARTBEAT = Path("/tmp/antares-tasks.heartbeat")
COMMANDS = ("serve", "veille", "meteo", "schedule", watch.TASK)
logger = logging.getLogger("tasks")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="antares-tasks",
        description="Veille informatique et météo d'antares (tâches planifiées)",
    )
    parser.add_argument(
        "command",
        nargs="?",
        default="serve",
        choices=COMMANDS,
        help=(
            "serve (défaut) : boucle planifiée ; veille, meteo, schedule, "
            "presidentielle-watch : à la main"
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="afficher le résultat sans rien enregistrer",
    )
    return parser.parse_args(argv)


def _refuse_write(data: dict) -> None:
    raise RuntimeError(
        "connections.json appartient au routeur : le service ne l'écrit jamais"
    )


def build_context(
    config: Config, dry_run: bool, http: httpx.AsyncClient
) -> jobs.Context:
    """Contexte réel : Connexions du routeur (sans écriture), base, horloge système."""
    # Le service n'écrit jamais la configuration partagée (cf. digest.py)
    connections.save = _refuse_write
    required = {"providers", *connections._services_defaults()}
    return jobs.Context(
        config=config,
        store=Store(settings.TASKS_DB, readonly=dry_run),
        http=http,
        complete=providers.complete,
        resolve=providers.resolve,
        connections_path=Path(connections.CONNECTIONS_PATH),
        connections_required=required,
        settings_path=settings.SETTINGS_PATH,
        features_path=settings.FEATURES_PATH,
        votes_path=settings.VOTES_DB,
        read_last_turn=lambda: calls.read_last_turn(http, settings.ROUTER_URL),
        presidentielle_dir=settings.PRESIDENTIELLE_DIR,
    )


async def main_async(args: argparse.Namespace, config: Config) -> int:
    readonly = args.dry_run or args.command == "schedule"
    async with feeds.new_client() as http:
        ctx = build_context(config, readonly, http)
        if args.command == "serve":
            if args.dry_run:
                print("serve ne connaît pas --dry-run", file=sys.stderr)
                return 2
            ctx.heartbeat = HEARTBEAT
            await jobs.serve(ctx)
            return 0
        if not readonly:
            ctx.store.init(ctx.now())
        if args.command == "schedule":
            print(jobs.schedule_report(ctx))
            return 0
        if args.command == watch.TASK:
            found = await watch.run_watch(ctx, dry_run=args.dry_run)
            print(watch.report(found))
            return 0
        if args.command == "meteo":
            data, error = await jobs.run_meteo(ctx, args.dry_run)
            print(data["text"] if data else error)
            return 0 if data else 1
        result = await jobs.run_veille(ctx, dry_run=args.dry_run)
        print(jobs.run_report(result))
        return 0 if result.record.status == "done" else 1


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        config = load_config()
    except ConfigError as exc:
        print(f"Configuration invalide : {exc}", file=sys.stderr)
        return 2
    try:
        return asyncio.run(main_async(args, config))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
