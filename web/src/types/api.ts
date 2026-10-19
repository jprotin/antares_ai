// Réponses du routeur et de nginx utilisées par l'interface (champs lus seulement)

export type Voice = {
  id: string;
  name: string;
  file: string;
  preview?: string;
  gender?: string;
  persona?: string;
  avatars?: string[];
  effect?: string;
};

export type Agent = {
  id: string;
  name: string;
  domain?: string;
  usage?: string;
  description?: string;
  instructions?: string;
};

export type Mode = {
  id: string;
  name: string;
  description?: string;
  usages: string[];
};

export type Settings = {
  voice?: string;
  model?: string;
  // Modèle de repli (Connexions)
  fallback?: string;
  project?: string;
  agent?: string | null;
  mode?: string | null;
};

export type Config = Record<string, unknown>;

export type NetState = {
  online: boolean;
  search?: boolean;
  searching?: boolean;
  sharing?: boolean;
};

export type WebSource = {
  n: number;
  title: string;
  url: string;
  domain: string;
  snippet?: string;
};

export type TurnWeb = {
  query?: string;
  offline?: boolean;
  sources?: WebSource[];
};

// Dernier tour préparé par le routeur (api/turn/last)
export type Turn = {
  at: number;
  agent?: string;
  notice?: string;
  projects: string[];
  sources: string[];
  skipped?: string[];
  code?: { lang: string; code: string }[];
  web?: TurnWeb;
};

export type AttachedDocument = {
  id: string;
  name: string;
  kind: string;
  tokens: number;
  voice: boolean;
};

export type ModelInfo = {
  name: string;
  label?: string;
  [key: string]: unknown;
};
