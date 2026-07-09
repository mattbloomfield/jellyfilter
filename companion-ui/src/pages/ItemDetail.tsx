import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { fetchEdl, fetchTranscript, toggleWord, suppressEntry, toggleCategory, addEntry, deleteEntry, reprocessItem, type EdlEntry, type NewEntryInput } from "../api/jellyfilter";
import { getImageUrl, type JellyfinItem } from "../api/jellyfin";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtDuration(secs: number): string {
  if (secs < 1) return "0s";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const CENSOR: Record<string, string> = {
  fuck: "f**k", fucking: "f**king", fucker: "f**ker", fucked: "f**ked", fucks: "f**ks",
  shit: "sh*t", shitting: "sh*tting", shitty: "sh*tty", bullshit: "bulls**t",
  bitch: "b*tch", bitches: "b*tches", bitching: "b*tching",
  bastard: "b*st*rd", bastards: "b*st*rds",
  goddamn: "g*dd*mn", goddamned: "g*dd*mned", goddammit: "g*dd*mmit",
  asshole: "*sshole", assholes: "*ssholes",
  cunt: "c**t", cock: "c**k", dick: "d*ck",
  pussy: "p*ssy", whore: "wh*re", slut: "sl*t",
};

function censor(word: string): string {
  const w = word.toLowerCase();
  if (CENSOR[w]) return CENSOR[w];
  if (w.length <= 2) return w;
  return w[0] + "*".repeat(Math.max(1, w.length - 2)) + w[w.length - 1];
}

// ── Timeline bar ───────────────────────────────────────────────────────────

function FilterTimeline({ entries, duration }: { entries: EdlEntry[]; duration: number }) {
  const all = entries.filter((e) => e.type === "mute" || e.type === "skip");
  const active = all.filter((e) => !e.suppressed);
  const filteredSecs = active.reduce((n, e) => n + (e.end - e.start), 0);

  return (
    <div className="mb-6">
      <div className="flex justify-between text-sm mb-2">
        <span className="text-gray-400">
          Filters{" "}
          <span className="font-bold text-white">{active.length}/{all.length}</span>
        </span>
        <span className="text-gray-400">
          Filtered Time{" "}
          <span className="font-bold text-white">{fmtDuration(filteredSecs)}</span>
        </span>
      </div>
      <div className="relative h-7 bg-violet-600 rounded-lg overflow-hidden">
        {active.map((e) => (
          <div
            key={e.id}
            className={`absolute top-0 bottom-0 opacity-80 ${e.type === "skip" ? "bg-red-400" : "bg-white"}`}
            style={{
              left: `${(e.start / duration) * 100}%`,
              width: `max(2px, ${((e.end - e.start) / duration) * 100}%)`,
            }}
            title={e.type === "skip" ? "Scene blackout" : "Muted"}
          />
        ))}
      </div>
    </div>
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  "sexual-content": "Sexual Content",
  "violence": "Violence",
  "substance-use": "Substance Use",
};

const NUDENET_LABELS: Record<string, string> = {
  FEMALE_BREAST_EXPOSED: "Breast",
  FEMALE_GENITALIA_EXPOSED: "Female nudity",
  MALE_GENITALIA_EXPOSED: "Male nudity",
  BUTTOCKS_EXPOSED: "Buttocks",
  ANUS_EXPOSED: "Explicit",
};

function formatLabels(labels: string[] | undefined): string {
  if (!labels?.length) return "";
  return labels.map((l) => NUDENET_LABELS[l] ?? l.replace(/_/g, " ").toLowerCase()).join(", ");
}

// ── Word picker ────────────────────────────────────────────────────────────

function ToggleCircle({ active }: { active: boolean }) {
  return (
    <div
      className={`w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
        active
          ? "border-violet-400 bg-violet-900"
          : "border-gray-600 bg-transparent"
      }`}
    >
      {active && (
        <div className="w-3 h-3 rounded-full bg-violet-400" />
      )}
    </div>
  );
}

interface WordGroupProps {
  word: string;
  entries: EdlEntry[];
  onToggle: (word: string, suppressed: boolean) => void;
  onDelete: (entryId: string) => void;
  pending: boolean;
}

function WordGroup({ word, entries, onToggle, onDelete, pending }: WordGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const allSuppressed = entries.every((e) => e.suppressed);
  const active = !allSuppressed;

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <div
        className="flex items-center px-4 py-3 hover:bg-gray-900 cursor-pointer select-none"
        onClick={() => setExpanded((x) => !x)}
      >
        <span className="text-gray-400 text-xs w-4 mr-2 flex-shrink-0">
          {expanded ? "▼" : "▶"}
        </span>
        <span className={`font-mono text-sm flex-1 ${active ? "text-white" : "line-through text-gray-600"}`}>
          {censor(word)}
        </span>
        <span className="text-gray-500 text-sm mr-4">{entries.length}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle(word, !allSuppressed);
          }}
          disabled={pending}
          className="disabled:opacity-50"
          title={allSuppressed ? "Enable filtering" : "Disable filtering"}
        >
          <ToggleCircle active={active} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-gray-800 divide-y divide-gray-900 bg-gray-950">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center px-6 py-2 gap-2">
              <span className="text-xs font-mono text-violet-400 w-14 flex-shrink-0">
                {fmtTime(e.start)}
              </span>
              <span className={`text-xs flex-1 ${e.suppressed ? "text-gray-600 line-through" : "text-gray-400"}`}>
                {censor(word)}
              </span>
              <button
                onClick={() => onDelete(e.id)}
                disabled={pending}
                title="Delete — removes from EDL and transcript so redetect won't re-add it"
                className="text-gray-700 hover:text-red-500 disabled:opacity-30 transition-colors text-sm leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface SceneGroupProps {
  category: string;
  entries: EdlEntry[];
  onToggleAll: (suppressed: boolean) => void;
  onToggleEntry: (entry: EdlEntry, suppressed: boolean) => void;
  onDelete: (entryId: string) => void;
  pending: boolean;
}

function SceneGroup({ category, entries, onToggleAll, onToggleEntry, onDelete, pending }: SceneGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const allSuppressed = entries.every((e) => e.suppressed);
  const active = !allSuppressed;
  const label = CATEGORY_LABELS[category] ?? category;

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <div
        className="flex items-center px-4 py-3 hover:bg-gray-900 cursor-pointer select-none"
        onClick={() => setExpanded((x) => !x)}
      >
        <span className="text-gray-400 text-xs w-4 mr-2 flex-shrink-0">
          {expanded ? "▼" : "▶"}
        </span>
        <span className={`text-sm flex-1 ${active ? "text-white" : "line-through text-gray-600"}`}>
          {label}
        </span>
        <span className="text-gray-500 text-sm mr-4">{entries.length}</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleAll(!allSuppressed);
          }}
          disabled={pending}
          className="disabled:opacity-50"
          title={allSuppressed ? "Enable filtering" : "Disable filtering"}
        >
          <ToggleCircle active={active} />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-gray-800 divide-y divide-gray-900 bg-gray-950">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center px-6 py-2 gap-3">
              <span className="text-xs font-mono text-violet-400 w-14 flex-shrink-0">
                {fmtTime(e.start)}
              </span>
              <span className={`text-xs ${e.suppressed ? "text-gray-600 line-through" : "text-gray-400"}`}>
                {fmtDuration(e.end - e.start)}
              </span>
              {e.labels?.length ? (
                <span className={`text-xs flex-1 ${e.suppressed ? "text-gray-600" : "text-gray-500"}`}>
                  {formatLabels(e.labels)}
                  {e.confidence != null && (
                    <span className="ml-1 opacity-50">{Math.round(e.confidence * 100)}%</span>
                  )}
                </span>
              ) : <span className="flex-1" />}
              <button
                onClick={() => onToggleEntry(e, !e.suppressed)}
                disabled={pending}
                className="disabled:opacity-50"
              >
                <ToggleCircle active={!e.suppressed} />
              </button>
              <button
                onClick={() => onDelete(e.id)}
                disabled={pending}
                title="Delete false positive"
                className="text-gray-700 hover:text-red-500 disabled:opacity-30 transition-colors text-sm leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const CATEGORIES = ["profanity", "sexual-content", "violence", "substance-use"] as const;

function parseTimecode(tc: string): number | null {
  const parts = tc.trim().split(":");
  try {
    if (parts.length === 3) return +parts[0] * 3600 + +parts[1] * 60 + parseFloat(parts[2]);
    if (parts.length === 2) return +parts[0] * 60 + parseFloat(parts[1]);
    if (parts.length === 1) return parseFloat(parts[0]);
  } catch { /* fall through */ }
  return null;
}

function AddEntryForm({ itemId }: { itemId: string }) {
  const qc = useQueryClient();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [category, setCategory] = useState<string>("profanity");
  const [word, setWord] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: (entry: NewEntryInput) => addEntry(itemId, entry),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["edl", itemId] });
      setStart(""); setEnd(""); setWord(""); setError("");
    },
    onError: () => setError("Failed to add entry."),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const s = parseTimecode(start);
    const en = parseTimecode(end);
    if (s == null || isNaN(s)) { setError("Invalid start time."); return; }
    if (en == null || isNaN(en)) { setError("Invalid end time."); return; }
    if (en <= s) { setError("End must be after start."); return; }
    setError("");
    mutation.mutate({ start: s, end: en, category, word: word.trim() || undefined });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 border border-gray-800 rounded-lg p-4 space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Add Manual Entry</p>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Start</label>
          <input
            value={start} onChange={(e) => setStart(e.target.value)}
            placeholder="1:24:55.32"
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white font-mono placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">End</label>
          <input
            value={end} onChange={(e) => setEnd(e.target.value)}
            placeholder="1:24:57.88"
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white font-mono placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Category</label>
          <select
            value={category} onChange={(e) => setCategory(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>
            ))}
          </select>
        </div>
        {category === "profanity" && (
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Word</label>
            <input
              value={word} onChange={(e) => setWord(e.target.value)}
              placeholder="optional"
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white font-mono placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>
        )}
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button
        type="submit"
        disabled={mutation.isPending}
        className="bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-medium rounded px-3 py-1.5 transition-colors"
      >
        {mutation.isPending ? "Adding…" : "Add Entry"}
      </button>
    </form>
  );
}

function WordFilterView({ itemId }: { itemId: string }) {
  const qc = useQueryClient();

  const { data: edl, isLoading } = useQuery({
    queryKey: ["edl", itemId],
    queryFn: () => fetchEdl(itemId),
    retry: false,
  });

  const wordMutation = useMutation({
    mutationFn: ({ word, suppressed }: { word: string; suppressed: boolean }) =>
      toggleWord(itemId, word, suppressed),
    onMutate: async ({ word, suppressed }) => {
      await qc.cancelQueries({ queryKey: ["edl", itemId] });
      const prev = qc.getQueryData(["edl", itemId]);
      qc.setQueryData(["edl", itemId], (old: typeof edl) => {
        if (!old) return old;
        return { ...old, entries: old.entries.map((e) => e.word === word ? { ...e, suppressed } : e) };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => { if (ctx?.prev) qc.setQueryData(["edl", itemId], ctx.prev); },
  });

  const entryMutation = useMutation({
    mutationFn: ({ entry, suppressed }: { entry: EdlEntry; suppressed: boolean }) =>
      suppressEntry(itemId, entry, suppressed),
    onMutate: async ({ entry, suppressed }) => {
      await qc.cancelQueries({ queryKey: ["edl", itemId] });
      const prev = qc.getQueryData(["edl", itemId]);
      qc.setQueryData(["edl", itemId], (old: typeof edl) => {
        if (!old) return old;
        return { ...old, entries: old.entries.map((e) => e.id === entry.id ? { ...e, suppressed } : e) };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => { if (ctx?.prev) qc.setQueryData(["edl", itemId], ctx.prev); },
  });

  const deleteMutation = useMutation({
    mutationFn: (entryId: string) => deleteEntry(itemId, entryId),
    onMutate: async (entryId) => {
      await qc.cancelQueries({ queryKey: ["edl", itemId] });
      const prev = qc.getQueryData(["edl", itemId]);
      qc.setQueryData(["edl", itemId], (old: typeof edl) => {
        if (!old) return old;
        return { ...old, entries: old.entries.filter((e) => e.id !== entryId) };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => { if (ctx?.prev) qc.setQueryData(["edl", itemId], ctx.prev); },
  });

  const categoryMutation = useMutation({
    mutationFn: ({ category, suppressed }: { category: string; suppressed: boolean }) =>
      toggleCategory(itemId, category, suppressed),
    onMutate: async ({ category, suppressed }) => {
      await qc.cancelQueries({ queryKey: ["edl", itemId] });
      const prev = qc.getQueryData(["edl", itemId]);
      qc.setQueryData(["edl", itemId], (old: typeof edl) => {
        if (!old) return old;
        return { ...old, entries: old.entries.map((e) => e.category === category ? { ...e, suppressed } : e) };
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => { if (ctx?.prev) qc.setQueryData(["edl", itemId], ctx.prev); },
  });

  if (isLoading) return <p className="text-gray-400 text-sm">Loading…</p>;
  if (!edl) return <p className="text-gray-500 text-sm italic">No filter data yet — still processing.</p>;

  const filtered = edl.entries.filter((e) => e.type === "mute" || e.type === "skip");
  if (!filtered.length) return <p className="text-gray-500 text-sm italic">No detections.</p>;

  // Word-based entries (profanity), grouped by word
  const wordEntries = filtered.filter((e) => e.word != null);
  const wordGroups = new Map<string, EdlEntry[]>();
  for (const e of wordEntries) {
    const key = e.word!;
    wordGroups.set(key, [...(wordGroups.get(key) ?? []), e]);
  }
  const sortedWords = [...wordGroups.entries()].sort((a, b) => b[1].length - a[1].length);

  // Scene-based entries (visual detections), grouped by category
  const sceneEntries = filtered.filter((e) => e.word == null);
  const sceneGroups = new Map<string, EdlEntry[]>();
  for (const e of sceneEntries) {
    const key = e.category;
    sceneGroups.set(key, [...(sceneGroups.get(key) ?? []), e]);
  }
  const sortedCategories = [...sceneGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const pending = wordMutation.isPending || entryMutation.isPending || categoryMutation.isPending || deleteMutation.isPending;

  return (
    <div>
      <FilterTimeline entries={edl.entries} duration={edl.duration_seconds} />
      <div className="space-y-1">
        {sortedWords.map(([word, entries]) => (
          <WordGroup
            key={word}
            word={word}
            entries={entries}
            onToggle={(w, suppressed) => wordMutation.mutate({ word: w, suppressed })}
            onDelete={(id) => deleteMutation.mutate(id)}
            pending={pending}
          />
        ))}
        {sortedCategories.map(([category, entries]) => (
          <SceneGroup
            key={category}
            category={category}
            entries={entries}
            onToggleAll={(suppressed) => categoryMutation.mutate({ category, suppressed })}
            onToggleEntry={(entry, suppressed) => entryMutation.mutate({ entry, suppressed })}
            onDelete={(id) => deleteMutation.mutate(id)}
            pending={pending}
          />
        ))}
      </div>
      <AddEntryForm itemId={itemId} />
    </div>
  );
}

// ── Transcript ─────────────────────────────────────────────────────────────

function TranscriptView({ itemId }: { itemId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["transcript", itemId],
    queryFn: () => fetchTranscript(itemId),
    retry: false,
  });

  if (isLoading) return <p className="text-gray-500 text-sm">Loading transcript…</p>;
  if (error) return <p className="text-gray-500 text-sm italic">Transcript not yet available.</p>;
  if (!data) return null;

  if (!data.segments) {
    const text = data.text ?? "";
    return (
      <div>
        <p className="text-xs text-gray-500 mb-2">{text.split(/\s+/).length.toLocaleString()} words</p>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 max-h-[32rem] overflow-y-auto">
          <p className="text-sm text-gray-300 leading-relaxed">{text}</p>
        </div>
      </div>
    );
  }

  const wordCount = data.segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
  const buckets: { label: string; text: string }[] = [];
  let currentMinute = -1;
  let currentParts: string[] = [];

  for (const seg of data.segments) {
    const minute = Math.floor(seg.start / 60);
    if (minute !== currentMinute) {
      if (currentParts.length > 0)
        buckets.push({ label: fmtTime(currentMinute * 60), text: currentParts.join(" ") });
      currentMinute = minute;
      currentParts = [seg.text];
    } else {
      currentParts.push(seg.text);
    }
  }
  if (currentParts.length > 0)
    buckets.push({ label: fmtTime(currentMinute * 60), text: currentParts.join(" ") });

  return (
    <div>
      <p className="text-xs text-gray-500 mb-2">{wordCount.toLocaleString()} words</p>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 max-h-[32rem] overflow-y-auto space-y-4">
        {buckets.map((b) => (
          <div key={b.label} className="flex gap-3">
            <span className="text-xs text-violet-500 font-mono mt-0.5 w-10 flex-shrink-0 pt-px">
              {b.label}
            </span>
            <p className="text-sm text-gray-300 leading-relaxed">{b.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

type Tab = "filters" | "transcript";

export function ItemDetail({ items }: { items: JellyfinItem[] }) {
  const { itemId } = useParams<{ itemId: string }>();
  const item = items.find((i) => i.Id === itemId);
  const [tab, setTab] = useState<Tab>("filters");

  const { data: edl } = useQuery({
    queryKey: ["edl", itemId],
    queryFn: () => fetchEdl(itemId!),
    enabled: !!itemId,
    retry: false,
  });

  const reprocessMutation = useMutation({
    mutationFn: () => reprocessItem(itemId!),
  });

  if (!itemId) return null;
  const imageTag = item?.ImageTags?.Primary;
  const activeCount = edl?.entries.filter((e) => (e.type === "mute" || e.type === "skip") && !e.suppressed).length;
  const totalCount = edl?.entries.filter((e) => e.type === "mute" || e.type === "skip").length;

  return (
    <div>
      <Link to="/library" className="text-sm text-gray-400 hover:text-white mb-4 inline-flex items-center gap-1">
        ← Library
      </Link>

      <div className="flex gap-4 mt-3 mb-6">
        {imageTag && (
          <img src={getImageUrl(itemId, imageTag)} alt={item?.Name}
            className="w-20 rounded-lg object-cover flex-shrink-0" />
        )}
        <div>
          <h1 className="text-xl font-semibold text-white">{item?.Name ?? itemId}</h1>
          {item?.SeriesName && <p className="text-gray-400 text-sm">{item.SeriesName}</p>}
          {item?.ProductionYear && <p className="text-gray-500 text-sm">{item.ProductionYear}</p>}
          {totalCount != null && (
            <p className="text-sm text-gray-400 mt-1">
              {activeCount}/{totalCount} filters active
            </p>
          )}
          <button
            onClick={() => {
              if (confirm("Reprocess this item? This will re-transcribe and run NudeNet. Existing word suppressions will be lost.")) {
                reprocessMutation.mutate();
              }
            }}
            disabled={reprocessMutation.isPending || reprocessMutation.isSuccess}
            className="mt-2 text-xs text-gray-600 hover:text-violet-400 disabled:opacity-40 transition-colors"
          >
            {reprocessMutation.isSuccess ? "↩ Queued for reprocessing" : reprocessMutation.isPending ? "Queueing…" : "⟳ Reprocess"}
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-800">
        {(["filters", "transcript"] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t ? "border-violet-500 text-white" : "border-transparent text-gray-400 hover:text-gray-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "filters" && <WordFilterView itemId={itemId} />}
      {tab === "transcript" && <TranscriptView itemId={itemId} />}
    </div>
  );
}
