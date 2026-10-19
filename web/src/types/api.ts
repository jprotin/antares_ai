// Réponses du routeur et de nginx utilisées par l'interface (champs lus seulement)

export type Voice = {
  id: string;
  name: string;
  file: string;
  preview?: string;
  gender?: string;
  persona?: string;
  avatars?: string[];
};

export type Agent = {
  id: string;
  name: string;
  domain?: string;
  usage?: string;
  instructions?: string;
};

export type Mode = { id: string; name: string; description?: string };

export type Settings = {
  voice?: string;
  model?: string;
  project?: string;
  agent?: string | null;
  mode?: string | null;
};

export type Config = Record<string, unknown>;
