function getBase(): string {
  const stored = localStorage.getItem("jellyfilter:api_url");
  if (stored) return stored.replace(/\/$/, "");
  return "http://localhost:8765";
}

function headers() {
  return {
    "X-Emby-Token": localStorage.getItem("jellyfilter:api_key") ?? "",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${getBase()}/jellyfilter${path}`, {
    method,
    headers: headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`JellyFilter ${path}: ${res.status}`);
  return res.json();
}

export interface FilterPreferences {
  userId: string;
  enabled: boolean;
  filters: {
    profanity: { enabled: boolean };
    violence: { enabled: boolean };
    "sexual-content": { enabled: boolean };
    "substance-use": { enabled: boolean };
  };
}

export interface QueueItem {
  id: number;
  media_path: string;
  jellyfin_id: string | null;
  status: "new" | "processing" | "done" | "failed";
  added_at: number;
  started_at: number | null;
  finished_at: number | null;
  error_message: string | null;
  hit_count: number | null;
  word_count: number | null;
  retry_count: number;
}

export interface QueueResponse {
  items: QueueItem[];
  pending: number;
  eta_seconds: number | null;
}

export interface EdlEntry {
  id: string;
  start: number;
  end: number;
  type: "mute" | "skip";
  category: string;
  word?: string;
  confidence: number;
  source: string;
  confirmed: boolean;
  suppressed?: boolean;
}

export interface EdlDocument {
  version: number;
  media_id: string;
  media_path: string;
  duration_seconds: number;
  generated_at: string;
  entries: EdlEntry[];
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResponse {
  media_path: string;
  segments: TranscriptSegment[] | null;
  text?: string; // plain-text fallback for old transcripts
  created_at: number;
}

export const fetchPreferences = () => req<FilterPreferences>("GET", "/preferences");
export const updatePreferences = (prefs: FilterPreferences) =>
  req<FilterPreferences>("PUT", "/preferences", prefs);

export const fetchEdl = (itemId: string) => req<EdlDocument>("GET", `/edl/${itemId}`);
export const fetchQueue = () => req<QueueResponse>("GET", "/queue");
export const fetchItemStatus = (itemId: string) =>
  req<{ status: string; hit_count: number | null }>("GET", `/status/${itemId}`);

export const fetchTranscript = (itemId: string) =>
  req<TranscriptResponse>("GET", `/transcript/${itemId}`);

export const toggleWord = (itemId: string, word: string, suppressed: boolean) =>
  req<{ word: string; suppressed: boolean; updated: number }>(
    "PUT", `/edl/${itemId}/word/${encodeURIComponent(word)}`, { suppressed }
  );

export const suppressEntry = (itemId: string, entry: EdlEntry, suppressed: boolean) =>
  req<EdlEntry>("PUT", `/edl/${itemId}/entry/${entry.id}`, { ...entry, suppressed });

export const toggleCategory = (itemId: string, category: string, suppressed: boolean) =>
  req<{ category: string; suppressed: boolean; updated: number }>(
    "PUT", `/edl/${itemId}/category/${encodeURIComponent(category)}`, { suppressed }
  );

export interface NewEntryInput {
  start: number;
  end: number;
  category: string;
  word?: string;
}

export const addEntry = (itemId: string, entry: NewEntryInput) =>
  req<EdlEntry>("POST", `/edl/${itemId}/entries`, entry);

export const retryQueueItem = (queueId: number) =>
  req<{ queued: boolean }>("POST", `/queue/${queueId}/retry`, {});

export interface PipelineSettings {
  media_paths: string[];
}

export const fetchPipeline = () => req<PipelineSettings>("GET", "/pipeline");
export const updatePipeline = (settings: PipelineSettings) =>
  req<PipelineSettings>("PUT", "/pipeline", settings);
