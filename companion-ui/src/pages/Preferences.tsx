import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchPreferences, updatePreferences, fetchPipeline, updatePipeline, type FilterPreferences } from "../api/jellyfilter";

const CATEGORIES: { key: keyof FilterPreferences["filters"]; label: string; description: string }[] = [
  { key: "profanity", label: "Profanity", description: "Fuck, shit, bitch, bastard, etc." },
  { key: "sexual-content", label: "Sexual Content", description: "Explicit sexual dialogue" },
  { key: "violence", label: "Violence", description: "Graphic violence descriptions" },
  { key: "substance-use", label: "Substance Use", description: "Drug and alcohol references" },
];


function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 ${
        enabled ? "bg-violet-600" : "bg-gray-700"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          enabled ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function ScanPaths() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["pipeline"], queryFn: fetchPipeline });
  const mutation = useMutation({
    mutationFn: updatePipeline,
    onSuccess: (d) => qc.setQueryData(["pipeline"], d),
  });

  const [newPath, setNewPath] = useState("");
  const paths = data?.media_paths ?? [];

  function removePath(path: string) {
    mutation.mutate({ media_paths: paths.filter((p) => p !== path) });
  }

  function addPath() {
    const trimmed = newPath.trim();
    if (!trimmed || paths.includes(trimmed)) return;
    mutation.mutate({ media_paths: [...paths, trimmed] });
    setNewPath("");
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-white">Scan Paths</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Directories the whisper pipeline monitors for new media.
          Changes take effect after restarting the whisper container.
        </p>
      </div>

      <div className="space-y-1.5">
        {paths.map((p) => (
          <div key={p} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
            <span className="text-sm font-mono text-gray-300 truncate">{p}</span>
            <button
              onClick={() => removePath(p)}
              className="text-gray-500 hover:text-red-400 ml-3 text-lg leading-none flex-shrink-0"
              title="Remove"
            >
              ×
            </button>
          </div>
        ))}
        {paths.length === 0 && (
          <p className="text-xs text-gray-500 italic">No paths configured.</p>
        )}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addPath()}
          placeholder="/mnt/nfs-media/Movies"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
        <button
          onClick={addPath}
          disabled={!newPath.trim()}
          className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
        >
          Add
        </button>
      </div>

      {mutation.isSuccess && (
        <p className="text-xs text-yellow-400">
          Saved — restart the whisper container for changes to take effect.
        </p>
      )}
    </div>
  );
}

export function Preferences() {
  const qc = useQueryClient();

  const { data: prefs, isLoading, error } = useQuery({
    queryKey: ["preferences"],
    queryFn: fetchPreferences,
  });

  const mutation = useMutation({
    mutationFn: updatePreferences,
    onSuccess: (data) => qc.setQueryData(["preferences"], data),
  });

  function update(patch: Partial<FilterPreferences>) {
    if (!prefs) return;
    mutation.mutate({ ...prefs, ...patch });
  }

  function toggleCategory(key: keyof FilterPreferences["filters"]) {
    if (!prefs) return;
    mutation.mutate({
      ...prefs,
      filters: {
        ...prefs.filters,
        [key]: { enabled: !prefs.filters[key].enabled },
      },
    });
  }

  if (isLoading) return <p className="text-gray-400">Loading…</p>;
  if (error) return <p className="text-red-400 text-sm">Could not reach JellyFilter API — is the whisper container running?</p>;
  if (!prefs) return null;

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-lg font-semibold">Preferences</h1>

      {/* Master toggle */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between">
        <div>
          <p className="font-medium text-white">Content Filtering</p>
          <p className="text-sm text-gray-400">Master switch — applies to all playback.</p>
        </div>
        <Toggle enabled={prefs.enabled} onChange={() => update({ enabled: !prefs.enabled })} />
      </div>

      {/* Category toggles */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800">
        <p className="px-4 pt-3 pb-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Categories
        </p>
        {CATEGORIES.map(({ key, label, description }) => (
          <div key={key} className="px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">{label}</p>
              <p className="text-xs text-gray-500">{description}</p>
            </div>
            <Toggle
              enabled={prefs.filters[key]?.enabled ?? false}
              onChange={() => toggleCategory(key)}
            />
          </div>
        ))}
      </div>

      {mutation.isError && <p className="text-red-400 text-sm">Failed to save.</p>}
      {mutation.isSuccess && <p className="text-green-400 text-sm">Saved.</p>}

      <ScanPaths />
    </div>
  );
}
