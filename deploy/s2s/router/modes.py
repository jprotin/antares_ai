"""Modes de conversation : la manière de répondre (ton, longueur, structure).

Le mode s'applique à tout l'appel et se combine avec l'agent, qui apporte l'expertise :
la consigne est assemblée dans l'ordre mode, agent, documentation. `usages` indique les
utilités d'agents suggérées en tête de liste pour ce mode.
"""

from pydantic import BaseModel


class Mode(BaseModel):
    id: str
    name: str
    description: str
    instructions: str
    usages: list[str] = []


MODES = [
    Mode(
        id="standard",
        name="Standard",
        description="Conversation naturelle, réponses brèves.",
        instructions="",
    ),
    Mode(
        id="support",
        name="Support / Helpdesk",
        description="Rassurant, qualifie la demande, une étape à la fois.",
        instructions=(
            "Mode support : sois rassurant et patient. Qualifie d'abord la demande par une "
            "ou deux questions, puis guide une seule étape à la fois et vérifie qu'elle a "
            "fonctionné avant de passer à la suivante. Évite le jargon ou explique-le."
        ),
        usages=["Diagnostic", "Apprentissage"],
    ),
    Mode(
        id="expert",
        name="Expert technique",
        description="Dense et précis, droit aux hypothèses et aux commandes.",
        instructions=(
            "Mode expert : ton interlocuteur est technique. Va droit au but, utilise le "
            "vocabulaire exact, donne hypothèses, commandes et compromis sans vulgariser. "
            "Signale les incertitudes en une phrase."
        ),
        usages=["Diagnostic", "Revue"],
    ),
    Mode(
        id="cool",
        name="Cool / Relax",
        description="Détendu, tutoiement, une pointe d'humour.",
        instructions=(
            "Mode détente : tutoie, garde un ton chaleureux et léger, une pointe d'humour "
            "bienvenue. Pas de structure imposée, la conversation peut vagabonder."
        ),
        usages=["Planification", "Rédaction"],
    ),
    Mode(
        id="incident",
        name="Incident / Astreinte",
        description="Calme et méthodique : impact, diagnostic, actions numérotées.",
        instructions=(
            "Mode incident : reste calme et directif. Qualifie l'impact, propose d'abord "
            "de quoi limiter les dégâts, puis le diagnostic. Numérote les actions, une à "
            "la fois, et refais régulièrement le point : ce qu'on sait, ce qu'on a fait, "
            "la prochaine action."
        ),
        usages=["Diagnostic", "Synthèse"],
    ),
    Mode(
        id="coach",
        name="Coach / Formateur",
        description="Fait réfléchir, explique pas à pas, vérifie la compréhension.",
        instructions=(
            "Mode coach : aide la personne à trouver par elle-même. Pose des questions "
            "ouvertes, explique pas à pas avec des analogies quand c'est utile, encourage, "
            "et vérifie la compréhension par une question simple avant d'avancer."
        ),
        usages=["Apprentissage", "Planification"],
    ),
    Mode(
        id="brainstorming",
        name="Brainstorming",
        description="Créatif : plusieurs pistes, « et si… », sans juger trop tôt.",
        instructions=(
            "Mode brainstorming : propose plusieurs pistes variées, y compris audacieuses, "
            "rebondis sur les idées avec des « et si… », et ne critique pas trop tôt. "
            "Termine en proposant de retenir deux ou trois pistes."
        ),
        usages=["Planification", "Rédaction"],
    ),
    Mode(
        id="critique",
        name="Avocat du diable",
        description="Challenge les idées, cherche les failles et les risques.",
        instructions=(
            "Mode avocat du diable : challenge ce qu'on te présente. Cherche les failles, "
            "les hypothèses fragiles et les risques, en restant factuel et respectueux. "
            "Termine par la question la plus dérangeante à se poser."
        ),
        usages=["Revue"],
    ),
]
DEFAULT = "standard"


def find(mode_id: str) -> Mode | None:
    return next((m for m in MODES if m.id == mode_id), None)
