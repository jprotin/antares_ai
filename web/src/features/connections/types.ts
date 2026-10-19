// Réponse de api/connections (champs lus par la fenêtre)

export type Provider = {
  id: string;
  name: string;
  type: "ollama" | "openai";
  url: string;
  local: boolean;
  enabled: boolean;
  no_reasoning?: boolean;
  has_key: boolean;
};

export type McpServer = {
  id: string;
  name: string;
  url: string;
  transport: string;
  enabled: boolean;
  has_token: boolean;
};

export type ServicesState = {
  rag: {
    mode: string;
    url?: string;
    qdrant_url?: string;
    has_write_token: boolean;
  };
  search: { enabled: boolean; url?: string };
  claude: {
    enabled: boolean;
    url?: string;
    models: string[];
    has_token: boolean;
  };
  mcp: McpServer[];
};

export type Connections = {
  providers: Provider[];
  status: Record<string, { error: string | null; count: number } | undefined>;
  fallbackModel: string;
  services: ServicesState;
};

// Résultat d'un test de fournisseur (api/connections/test)
export type ProviderTest = {
  ok: boolean;
  seconds?: number;
  count?: number;
  error?: string;
  firstModel?: string;
  firstToken?: { seconds?: number; error?: string; reasoning?: number };
};
