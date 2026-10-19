// Données des répétitions renvoyées par le routeur (api/rehearsals), champs lus seulement

export type Audience = { id: string; name: string };

export type HistoryItem = {
  id: string;
  created: number;
  title: string;
  audience_name: string;
  slides: number;
  duration: number | null;
  score: number | null;
  initial_score?: number | null;
};

export type Criterion = {
  key: string;
  label: string;
  score: number;
  max: number;
  comment: string;
};

export type Revision = {
  at: number;
  criterion: string;
  label: string;
  before: number;
  after: number;
  reason?: string;
};

export type Report = {
  created: number;
  score: number;
  out_of: number;
  initial_score?: number | null;
  verdict: string;
  criteria: Criterion[];
  strengths: string[];
  improvements: { issue: string; slide?: number; advice?: string }[];
  avoid: { quote: string; why?: string; instead?: string }[];
  answers: { question: string; assessment?: string; better?: string }[];
  metrics: {
    duration: number;
    target_seconds?: number;
    words: number;
    words_per_minute: number;
    per_slide: { slide: number; seconds: number }[];
    skipped: number[];
    fillers: Record<string, number>;
  };
  script: { section: string; text: string }[];
  revisions?: Revision[];
};

export type DiscussionMessage = {
  role: "user" | "assistant";
  text: string;
  via?: "text" | "voice";
  revisions?: Revision[];
};

export type RehearsalData = {
  id: string;
  title: string;
  audience_name: string;
  target_minutes?: number;
  slides: { number: number; text?: string }[];
  report?: Report;
  discussion?: DiscussionMessage[];
};

export type Exchange = { role: "user" | "assistant"; text: string };

export type Segment = {
  slide: number;
  start: number;
  end: number;
  text: string;
};
