"""Index des passages relus (presidentielle_index.py) : recherche par mots, index par le
sens dans un RAG intégré simulé (service et Qdrant en mémoire, httpx.MockTransport),
reconstruction sous verrou, masquage des collections proj-p27-* (rag.py, ragstore.py).

python -m unittest test_presidentielle_index (dans router/, cf. README).
"""

import asyncio
import dataclasses
import json
import re
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import httpx

import presidentielle
import presidentielle_api
import presidentielle_index as index
import rag
import ragstore
from test_presidentielle_routes import FIXTURES, OWNER, Base

ALINE, BRUNO, CARLA = "aline-fictiva", "bruno-demonstra", "carla-exemplia"
PARTICIPANTS = [ALINE, BRUNO, CARLA]
JETON = "jeton-de-test"


def integre(**champs) -> SimpleNamespace:
    valeurs = {
        "mode": "integrated",
        "url": "http://rag:8100",
        "qdrant_url": "http://qdrant:6333",
        "write_token": JETON,
    }
    return SimpleNamespace(**{**valeurs, **champs})


class RagSimule:
    """Service RAG intégré et Qdrant en mémoire : {collection: {doc_id: texte}}."""

    def __init__(self, collections: dict[str, dict[str, str]] | None = None):
        self.collections = collections or {}
        self.requetes: list[tuple[str, str]] = []
        self.hits: list[dict] | None = None
        self.en_vol = 0
        self.max_en_vol = 0
        self.delai = 0.0

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        chemin = request.url.path
        self.requetes.append((request.method, f"{request.url.host}{chemin}"))
        if request.url.host == "qdrant":
            if request.method == "GET" and chemin == "/collections":
                noms = [{"name": n} for n in sorted(self.collections)]
                return httpx.Response(200, json={"result": {"collections": noms}})
            found = re.fullmatch(r"/collections/([^/]+)", chemin)
            if request.method == "DELETE" and found:
                existe = self.collections.pop(found.group(1), None) is not None
                return httpx.Response(200 if existe else 404, json={"result": existe})
            if request.method == "GET" and found:
                points = len(self.collections.get(found.group(1), {}))
                return httpx.Response(200, json={"result": {"points_count": points}})
        corps = json.loads(request.content or b"{}")
        if chemin == "/documents" and request.method == "POST":
            if request.headers.get("authorization") != f"Bearer {JETON}":
                return httpx.Response(401, json={"error": "unauthorized"})
            self.en_vol += 1
            self.max_en_vol = max(self.max_en_vol, self.en_vol)
            await asyncio.sleep(self.delai)
            self.en_vol -= 1
            self.collections.setdefault(corps["collection"], {})[corps["doc_id"]] = (
                corps["text"]
            )
            return httpx.Response(200, json={"doc_id": corps["doc_id"], "chunks": 1})
        if chemin == "/query":
            if self.hits is not None:
                return httpx.Response(200, json={"hits": self.hits})
            mots = index.mots(corps["query"])
            hits = [
                {
                    "score": 1.0,
                    "source": doc,
                    "collection": nom,
                    "text": texte,
                    "doc_id": doc,
                    "origin": "presidentielle",
                }
                for nom in corps["collections"]
                for doc, texte in self.collections.get(nom, {}).items()
                if mots & index.mots(texte)
            ]
            return httpx.Response(200, json={"hits": hits[: corps["limit"]]})
        return httpx.Response(404, json={"error": "not found"})

    def textes(self) -> list[str]:
        return [t for docs in self.collections.values() for t in docs.values()]


class Commun(Base):
    def setUp(self):
        super().setUp()
        self.etat_index = Path(tempfile.mkdtemp()) / "presidentielle-index.json"
        self.config = integre()
        self.rag = RagSimule()
        self.http = httpx.AsyncClient(transport=httpx.MockTransport(self.rag))
        self.index = index.Index(self.etat_index, lambda: self.config, self.http)

    def etat(self) -> presidentielle.Etat:
        return presidentielle.relire(self.dossier)

    def executer(self, coro):
        return asyncio.run(coro)


class RechercheParMots(Commun):
    def test_recherche_par_mots_accents(self):
        found = index.rechercher_par_mots(
            self.etat(), "education primaire", PARTICIPANTS
        )
        self.assertEqual([p.id for p in found], ["p27:aline-fictiva:educ-classes"])
        found = index.rechercher_par_mots(self.etat(), "MÉDECINS", PARTICIPANTS)
        self.assertEqual({p.candidat for p in found}, set(PARTICIPANTS))

    def test_recherche_par_mots_bornes(self):
        etat = self.etat()
        tous = index.passages(etat)
        self.assertTrue(all(len(p.texte) < 1000 for p in tous))
        self.assertTrue(
            all(re.fullmatch(r"p27:[a-z0-9-]+:[a-z0-9-]+", p.id) for p in tous)
        )
        self.assertTrue(
            all(index.lire_doc_id(p.id) == (p.candidat, p.mesure) for p in tous)
        )
        # Question qui touche tous les passages : 2 par candidat, 12 au plus
        question = " ".join(sorted({m for p in tous for m in index.mots(p.texte)}))
        found = index.rechercher_par_mots(etat, question, sorted(etat.fiches))
        compte: dict[str, int] = {}
        for p in found:
            compte[p.candidat] = compte.get(p.candidat, 0) + 1
        self.assertEqual(max(compte.values()), 2)
        self.assertLessEqual(len(found), 12)

    def test_recherche_par_mots_passage_long_tronque(self):
        def longue(data):
            data["mesures"][0]["citation"] = "Impôt " + "très " * 400 + "long."

        self.modifier("candidats/aline-fictiva.yaml", longue)
        (passage,) = [p for p in index.passages(self.etat()) if p.mesure == "eco-impot"
                      and p.candidat == ALINE]  # fmt: skip
        self.assertEqual(len(passage.texte), 999)

    def test_recherche_par_mots_candidats_retenus(self):
        found = index.rechercher_par_mots(self.etat(), "impôt", [BRUNO])
        self.assertEqual({p.candidat for p in found}, {BRUNO})
        self.assertEqual(
            index.rechercher_par_mots(self.etat(), "le la les", PARTICIPANTS), []
        )

    def test_lire_doc_id(self):
        self.assertEqual(
            index.lire_doc_id("p27:aline-fictiva:eco-impot"), (ALINE, "eco-impot")
        )
        for valeur in ("p27:../x", "p27:aline", "p27:a:b:c", "p28:a:b", "", None, 3,
                       "p27:Aline:eco", "p27:a:b\n"):  # fmt: skip
            self.assertIsNone(index.lire_doc_id(valeur))


class Reconstruction(Commun):
    def test_reconstruction_efface_puis_recree(self):
        self.rag.collections = {
            "proj-p27-ancien": {"p27:ancien:m1": "Ancien candidat"},
            "proj-p27-aline-fictiva": {"p27:aline-fictiva:vieux": "Ancien texte"},
            "proj-autre": {"file:a.md": "Projet de l'utilisateur"},
            "knowledge": {"k": "Fiche commune"},
        }
        etat = self.etat()
        nombre = self.executer(self.index.reconstruire(etat))
        self.assertEqual(nombre, len(index.passages(etat)))
        self.assertEqual(
            self.rag.collections["proj-autre"], {"file:a.md": "Projet de l'utilisateur"}
        )
        self.assertIn("knowledge", self.rag.collections)
        # Collection proj-p27-* d'aucun candidat connu, ni de l'index précédent :
        # jamais supprimée (pas d'effacement de tout le préfixe)
        self.assertIn("proj-p27-ancien", self.rag.collections)
        self.assertNotIn(
            ("DELETE", "qdrant/collections/proj-p27-ancien"), self.rag.requetes
        )
        attendus = {p.id for p in index.passages(etat)}
        presents = {
            doc
            for nom, docs in self.rag.collections.items()
            if nom.startswith("proj-p27-") and nom != "proj-p27-ancien"
            for doc in docs
        }
        self.assertEqual(presents, attendus)
        # Suppressions avant toute écriture
        premiers_post = next(
            i for i, (m, c) in enumerate(self.rag.requetes) if m == "POST"
        )
        dernier_delete = max(
            i for i, (m, c) in enumerate(self.rag.requetes) if m == "DELETE"
        )
        self.assertLess(dernier_delete, premiers_post)
        self.assertEqual(
            json.loads(self.etat_index.read_text())["version"], etat.version
        )
        self.assertTrue(self.index.a_jour(etat))

    def test_collections_de_l_index_precedent_supprimees(self):
        # Entre les tours, la vue ne garde que 2 qualifiés : les collections des autres,
        # inscrites dans l'état de l'index précédent, sont supprimées ; une collection
        # inconnue (autre usage du préfixe) reste
        etat = self.etat()
        self.executer(self.index.reconstruire(etat))
        indexees = self.index.collections_indexees()
        self.assertIn(index.collection(CARLA), indexees)
        self.rag.collections["proj-p27-autre-usage"] = {"x": "Autre usage"}
        vue = dataclasses.replace(
            etat, fiches={s: f for s, f in etat.fiches.items() if s != CARLA}
        )
        self.executer(self.index.reconstruire(vue))
        self.assertNotIn(index.collection(CARLA), self.rag.collections)
        self.assertIn("proj-p27-autre-usage", self.rag.collections)
        self.assertNotIn(index.collection(CARLA), self.index.collections_indexees())
        # État illisible ou trafiqué : seuls des noms proj-p27-<identifiant> comptent
        self.etat_index.write_text(
            json.dumps({"collections": ["knowledge", "proj-p27-../x", 3]})
        )
        self.assertEqual(self.index.collections_indexees(), set())

    def test_aucun_ancien_passage_apres_restauration(self):
        ancien = "Nous lancerons la construction de six nouveaux réacteurs."
        nouveau = "Nous lancerons la construction de deux petits réacteurs modulaires."
        self.executer(self.index.reconstruire(self.etat()))

        def publier(texte):
            def change(data):
                for mesure in data["mesures"]:
                    if mesure["id"] == "ecolo-nucleaire":
                        mesure["citation"] = texte

            return change

        self.modifier("candidats/aline-fictiva.yaml", publier(nouveau))
        publiee = self.etat()
        self.assertFalse(self.index.a_jour(publiee))
        self.executer(self.index.reconstruire(publiee))
        self.assertFalse(any(ancien in t for t in self.rag.textes()))
        # Retour arrière, puis reconstruction : le texte publié par erreur disparaît
        self.modifier("candidats/aline-fictiva.yaml", publier(ancien))
        restauree = self.etat()
        self.executer(self.index.reconstruire(restauree))
        self.assertFalse(any(nouveau in t for t in self.rag.textes()))
        found, moteur = self.executer(
            self.index.rechercher(
                restauree, "petits réacteurs modulaires", PARTICIPANTS
            )
        )
        self.assertEqual(moteur, "sens")
        self.assertTrue(found)
        for passage in found:
            self.assertNotIn("modulaires", passage.texte)

    def test_doc_id_absent_de_la_base_ecarte(self):
        etat = self.etat()
        self.rag.hits = json.loads((FIXTURES / "index_rag.json").read_text())["hits"]
        found = self.executer(
            self.index.rechercher_par_le_sens(etat, "énergie", PARTICIPANTS)
        )
        self.assertEqual(
            [p.id for p in found],
            [
                "p27:aline-fictiva:ecolo-nucleaire",
                "p27:bruno-demonstra:ecolo-nucleaire",
            ],
        )
        # Texte relu dans la base, jamais celui de l'index
        for passage in found:
            mesure = next(
                m
                for m in etat.fiches[passage.candidat].mesures
                if m.id == passage.mesure
            )
            self.assertIn(mesure.citation, passage.texte)
        self.assertFalse(any("index" in p.texte for p in found))
        # Candidat non retenu : écarté
        found = self.executer(
            self.index.rechercher_par_le_sens(etat, "énergie", [BRUNO])
        )
        self.assertEqual([p.candidat for p in found], [BRUNO])

    def test_reconstruction_sous_verrou(self):
        self.rag.delai = 0.005
        etat = self.etat()

        async def deux():
            return await asyncio.gather(
                self.index.reconstruire(etat), self.index.reconstruire(etat)
            )

        self.assertEqual(self.executer(deux()), [len(index.passages(etat))] * 2)
        self.assertEqual(self.rag.max_en_vol, 1)
        # Aucune écriture de la seconde ne se mêle à la première : une suite de
        # suppressions, puis d'écritures, deux fois
        sequence = "".join("E" if m == "POST" else "S" for m, _ in self.rag.requetes
                           if m in ("POST", "DELETE"))  # fmt: skip
        self.assertRegex(sequence, r"^E+S+E+$")

    def test_recherche_par_mots_en_attendant(self):
        etat = self.etat()
        found, moteur = self.executer(
            self.index.rechercher(etat, "éducation", PARTICIPANTS)
        )
        self.assertEqual(moteur, "mots")
        self.assertEqual([p.mesure for p in found], ["educ-classes"])
        self.assertNotIn(("POST", "rag:8100/query"), self.rag.requetes)
        # RAG en panne après reconstruction : recherche par mots
        self.executer(self.index.reconstruire(etat))

        async def panne(request):
            raise httpx.ConnectError("injoignable")

        self.index.http = httpx.AsyncClient(transport=httpx.MockTransport(panne))
        found, moteur = self.executer(
            self.index.rechercher(etat, "éducation", PARTICIPANTS)
        )
        self.assertEqual(moteur, "mots")
        self.assertTrue(found)

    def test_rag_existant_jamais_ecrit(self):
        self.config = integre(mode="existing")
        self.assertFalse(self.index.actif())
        with self.assertRaises(RuntimeError):
            self.executer(self.index.reconstruire(self.etat()))
        self.assertEqual(self.rag.requetes, [])
        self.config = integre(write_token="")
        self.assertFalse(self.index.actif())

    def test_echec_laisse_l_index_perime(self):
        self.executer(self.index.reconstruire(self.etat()))
        self.config = integre(write_token="mauvais-jeton")
        with self.assertRaises(RuntimeError):
            self.executer(self.index.reconstruire(self.etat()))
        self.assertIsNone(self.index.version_indexee())
        self.assertFalse(self.index.a_jour(self.etat()))


class Robustesse(Commun):
    def test_reponse_rag_illisible_recherche_par_mots(self):
        etat = self.etat()
        self.executer(self.index.reconstruire(etat))

        async def liste(request):
            return httpx.Response(200, json=["pas", "un", "objet"])

        self.index.http = httpx.AsyncClient(transport=httpx.MockTransport(liste))
        found, moteur = self.executer(
            self.index.rechercher(etat, "éducation", PARTICIPANTS)
        )
        self.assertEqual(moteur, "sens")
        self.assertEqual(found, [])

        async def objet_bizarre(request):
            return httpx.Response(200, json={"hits": "texte"})

        self.index.http = httpx.AsyncClient(
            transport=httpx.MockTransport(objet_bizarre)
        )
        found, moteur = self.executer(
            self.index.rechercher(etat, "éducation", PARTICIPANTS)
        )
        self.assertEqual(found, [])

    def test_recherche_par_le_sens_lente_recherche_par_mots(self):
        etat = self.etat()
        self.executer(self.index.reconstruire(etat))

        async def lent(request):
            await asyncio.sleep(1)
            return httpx.Response(200, json={"hits": []})

        self.index.http = httpx.AsyncClient(transport=httpx.MockTransport(lent))
        with mock.patch.object(index, "DELAI_SENS", 0.05):
            found, moteur = self.executer(
                self.index.rechercher(etat, "éducation", PARTICIPANTS)
            )
        self.assertEqual(moteur, "mots")
        self.assertTrue(found)

    def test_une_requete_par_candidat_dans_l_ordre(self):
        etat = self.etat()
        self.executer(self.index.reconstruire(etat))
        corps: list[dict] = []
        rag_simule = self.rag

        async def note(request):
            if request.url.path == "/query":
                corps.append(json.loads(request.content))
            return await rag_simule(request)

        self.index.http = httpx.AsyncClient(transport=httpx.MockTransport(note))
        ordre = [CARLA, ALINE, BRUNO]
        self.executer(
            self.index.rechercher(etat, "santé médecins", PARTICIPANTS, ordre)
        )
        self.assertEqual(
            [c["collections"] for c in corps], [[index.collection(c)] for c in ordre]
        )
        self.assertEqual({c["limit"] for c in corps}, {2})

    def test_sens_candidats_sans_mesure_sautes_et_classement_par_score(self):
        etat = self.etat()
        self.executer(self.index.reconstruire(etat))
        sans_mesure = etat.fiches[CARLA].model_copy(update={"mesures": []})
        vue = dataclasses.replace(etat, fiches={**etat.fiches, CARLA: sans_mesure})
        corps: list[dict] = []
        scores = {ALINE: 0.2, BRUNO: 0.9}

        async def note(request):
            data = json.loads(request.content)
            corps.append(data)
            slug = data["collections"][0].removeprefix(index.PREFIXE_COLLECTION)
            mesure = vue.fiches[slug].mesures[0].id
            hit = {
                "score": scores[slug],
                "collection": data["collections"][0],
                "doc_id": index.doc_id(slug, mesure),
            }
            return httpx.Response(200, json={"hits": [hit]})

        self.index.http = httpx.AsyncClient(transport=httpx.MockTransport(note))
        found = self.executer(
            self.index.rechercher_par_le_sens(
                vue, "santé", PARTICIPANTS, [ALINE, CARLA, BRUNO]
            )
        )
        # Carla, sans mesure : aucune requête ; meilleur score d'abord, quel que soit
        # l'ordre tiré
        self.assertEqual(
            [c["collections"] for c in corps],
            [[index.collection(ALINE)], [index.collection(BRUNO)]],
        )
        self.assertEqual([p.candidat for p in found], [BRUNO, ALINE])
        # Score égal : l'ordre tiré au sort départage (jamais l'ordre alphabétique)
        scores[BRUNO] = 0.2
        found = self.executer(
            self.index.rechercher_par_le_sens(
                vue, "santé", PARTICIPANTS, [BRUNO, ALINE]
            )
        )
        self.assertEqual([p.candidat for p in found], [BRUNO, ALINE])

    def test_reconstruction_interrompue_par_un_appel(self):
        etat = self.etat()
        appels = iter([False, False, True])
        with self.assertRaises(RuntimeError):
            self.executer(self.index.reconstruire(etat, lambda: next(appels, True)))
        self.assertIsNone(self.index.version_indexee())
        self.assertFalse(self.index.a_jour(etat))


class ReconstructionAutomatique(Commun):
    """Par l'API montée seule : la version change, l'assistant lance la reconstruction
    et cherche par mots en attendant ; POST /index par l'accès local."""

    def construire(self, voix: float = 0.0):
        from fastapi import FastAPI

        async def complete(*args, **kwargs):
            return '{"passages": []}'

        async def available(name):
            return True

        dep = presidentielle_api.Dependances(
            sharing=lambda: False,
            owner=lambda: OWNER,
            load_settings=lambda: SimpleNamespace(model="ollama/gemma4:e4b"),
            model_available=available,
            last_voice_at=lambda: voix,
            idle_seconds=lambda: 120,
            complete=complete,
            index=self.index,
        )
        app = FastAPI()
        app.include_router(presidentielle_api.construire(dep))
        return app

    def scenario(self, app, actions):
        async def principal():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
                resultat = await actions(c)
                if self.index.tache is not None:
                    await self.index.tache
                return resultat

        return asyncio.run(principal())

    def test_reconstruction_automatique_quand_la_version_change(self):
        app = self.construire()

        async def actions(client):
            return await client.post(
                "/api/presidentielle/ask",
                json={"question": "Que prévoient-ils pour les réacteurs ?"},
            )

        response = self.scenario(app, actions)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["moteur"], "mots")
        self.assertTrue(self.index.a_jour(self.etat()))
        response = self.scenario(app, actions)
        self.assertEqual(response.json()["moteur"], "sens")

    def test_pas_de_reconstruction_pendant_un_appel(self):
        import time

        app = self.construire(voix=time.time())

        async def actions(client):
            return await client.post(
                "/api/presidentielle/ask", json={"question": "et l'éducation ?"}
            )

        self.assertEqual(self.scenario(app, actions).status_code, 200)
        self.assertIsNone(self.index.tache)

        async def index_route(client):
            return await client.post("/api/presidentielle/index", json={})

        self.assertEqual(self.scenario(app, index_route).status_code, 409)

    def test_route_index_locale(self):
        app = self.construire()

        async def actions(client):
            return await client.post("/api/presidentielle/index", json={})

        response = self.scenario(app, actions)
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["kind"], "index")
        self.assertTrue(self.index.a_jour(self.etat()))


class Masquage(unittest.TestCase):
    """Collections proj-p27-* invisibles des Réglages, de la page Projets et de cited."""

    COLLECTIONS = {
        "proj-p27-aline-fictiva": {"p27:aline-fictiva:eco-impot": "x"},
        "proj-p27-bruno-demonstra": {"p27:bruno-demonstra:eco-impot": "y"},
        "proj-mon-appli": {"file:a.md": "z"},
        "knowledge": {"k": "w"},
    }

    def setUp(self):
        self.rag = RagSimule({k: dict(v) for k, v in self.COLLECTIONS.items()})
        for patch in (
            mock.patch.object(rag, "http", httpx.AsyncClient(transport=httpx.MockTransport(self.rag))),
            mock.patch.object(rag.connections, "rag", lambda: integre()),
            mock.patch.object(rag, "_projects_cache", (0.0, [])),
        ):  # fmt: skip
            patch.start()
            self.addCleanup(patch.stop)

    def test_projets_p27_masques(self):
        projets = asyncio.run(rag.projects())
        self.assertEqual([p["id"] for p in projets], ["mon-appli"])

    def test_rag_cited_ignore_p27(self):
        projets = asyncio.run(rag.projects())
        self.assertEqual(rag.cited("que dit p27 aline fictiva sur mon appli", projets),
                         ["mon-appli"])  # fmt: skip
        self.assertEqual(rag.cited("p27-bruno-demonstra", projets), [])

    def test_ragstore_refuse_p27(self):
        for projet in ("p27-x", "p27-aline-fictiva"):
            with self.subTest(projet=projet), self.assertRaises(ragstore.StoreError):
                ragstore._collection(projet)
        self.assertEqual(ragstore._collection("mon-appli"), "proj-mon-appli")
        self.assertEqual(ragstore._collection("p27x"), "proj-p27x")


if __name__ == "__main__":
    unittest.main()
