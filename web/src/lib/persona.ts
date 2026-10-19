// Consignes du personnage pour l'oral et l'écrit (port de settings.js, textes inchangés :
// ils ont été réglés sur les modèles, cf. voicecode.py).

export type PersonaVoice = {
  name: string;
  gender?: string;
  persona?: string;
};

// Bref par défaut, mais sans brider les contenus longs demandés explicitement
// (gemma4 coupait un poème après une strophe avec « phrases courtes »).
// La règle du code vient en premier : placée après « sans markdown », le modèle
// l'ignorait pour les requêtes courtes (SQL : 0/3 ; en premier : 12/12, cf. voicecode.py).
const BASE_INSTRUCTIONS =
  "Règle prioritaire : dès que ta réponse contient du code, même une seule ligne " +
  "(script, commande, requête SQL, fichier de configuration, Dockerfile), écris ce code " +
  "entre trois accents graves avec le langage (```sql, puis le code, puis ```). Ce bloc " +
  "s'affiche à l'écran et n'est jamais lu. Autour, en phrases parlées, annonce que tu " +
  "l'affiches à l'écran puis explique ce qu'il fait étape par étape, sans lire le code " +
  "ni parler de Markdown. " +
  "Pour tout le reste, réponds toujours en français, de façon naturelle et sans markdown " +
  "ni listes. En conversation, reste bref. Si l'on te demande un contenu long (poème, " +
  "histoire, explication détaillée), donne-le en entier, sans t'arrêter pour demander " +
  "s'il faut continuer.";

// À l'écrit, la mise en forme est rendue (render.js) : Markdown encouragé
const WRITTEN_INSTRUCTIONS =
  "Réponds toujours en français. L'échange se fait à l'écrit : structure tes réponses " +
  "en Markdown quand c'est utile (titres courts, listes, tableaux, citations avec >, " +
  "blocs de code avec le langage indiqué et une indentation soignée). Reste concis pour " +
  "une question simple. Ne cite un lien Internet que pour une page de documentation " +
  "officielle dont tu es certain de l'adresse ; n'invente jamais d'URL.";

// Caractère du personnage (voices.json : "persona") : il donne le ton et la façon de
// parler ; l'agent et le mode, ajoutés ensuite par le routeur, décident du fond.
const PERSONA_RULE =
  "Ce caractère donne ton ton et ta façon de parler : garde-le même si un agent ou un " +
  "mode te sont donnés ensuite. L'agent décide du fond et de la méthode, le mode de " +
  "l'attitude générale ; ton personnage ne change jamais l'exactitude des faits, du " +
  "code ou des commandes.";

// À l'oral, le personnage colore la réponse sans l'allonger
const SPOKEN_PERSONA_RULE =
  "À l'oral, reste bref : trois à cinq phrases, avec une ou deux touches de caractère, " +
  "sauf si un contenu long est demandé.";

function identity(voice: PersonaVoice, spoken: boolean): string {
  if (voice.persona) {
    const rules = spoken
      ? `${PERSONA_RULE} ${SPOKEN_PERSONA_RULE}`
      : PERSONA_RULE;
    return `Tu es ${voice.name}, ${voice.persona} ${rules}`;
  }
  const [male, female] = spoken
    ? ["un assistant vocal bienveillant", "une assistante vocale bienveillante"]
    : ["un assistant bienveillant", "une assistante bienveillante"];
  return `Tu es ${voice.name}, ${voice.gender === "M" ? male : female}.`;
}

export function writtenInstructionsFor(voice: PersonaVoice): string {
  return `${identity(voice, false)} ${WRITTEN_INSTRUCTIONS}`;
}

export function instructionsFor(voice: PersonaVoice): string {
  return `${identity(voice, true)} ${BASE_INSTRUCTIONS}`;
}
