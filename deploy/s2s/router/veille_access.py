"""Droits sur la veille pendant un partage ngrok (share.sh) : lecture pour tous ; écriture
(votes, étoiles, sources, passage manuel, nouveaux prompts et traductions) pour le
propriétaire seulement.

Une requête venue du tunnel porte toujours l'en-tête `x-antares-user` : ngrok le retire
de la requête de l'invité puis l'écrit avec l'adresse de son compte Google, après la
connexion (politique de trafic de share.sh) ; ngrok ajoute aussi `x-forwarded-for`.
Une requête locale (127.0.0.1, sans tunnel) n'a ni l'un ni l'autre : accès complet.
Propriétaire : adresse SHARE_OWNER_EMAIL (.env) ; vide, tout le tunnel est en lecture.
"""

from collections.abc import Mapping

USER_HEADER = "x-antares-user"


def is_guest(headers: Mapping[str, str], owner: str) -> bool:
    """Vrai pour une requête du tunnel qui n'est pas celle du propriétaire."""
    user = headers.get(USER_HEADER)
    if user is None and "x-forwarded-for" not in headers:
        return False
    owner = owner.strip().lower()
    return not owner or (user or "").strip().lower() != owner
