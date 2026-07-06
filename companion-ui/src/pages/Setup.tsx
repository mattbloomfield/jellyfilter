import { useState } from "react";
import { saveSetup } from "../hooks/useSetup";

export function Setup() {
  const [jellyfinUrl, setJellyfinUrl] = useState(localStorage.getItem("jellyfilter:jellyfin_url") ?? "");
  const [apiKey, setApiKey] = useState("");
  const [apiUrl, setApiUrl] = useState(localStorage.getItem("jellyfilter:api_url") ?? "");
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setTesting(true);
    try {
      const res = await fetch(`${jellyfinUrl.replace(/\/$/, "")}/System/Info/Public`);
      if (!res.ok) throw new Error("Could not reach Jellyfin server");
      saveSetup(jellyfinUrl, apiKey, apiUrl);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 w-full max-w-md">
        <h1 className="text-xl font-bold text-violet-400 mb-1">JellyFilter Setup</h1>
        <p className="text-sm text-gray-400 mb-6">Connect to your Jellyfin server to get started.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Jellyfin Server URL
            </label>
            <input
              type="url"
              value={jellyfinUrl}
              onChange={(e) => setJellyfinUrl(e.target.value)}
              placeholder="http://your-jellyfin-host:8096"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Generate in Jellyfin → Dashboard → API Keys"
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              JellyFilter API URL
            </label>
            <input
              type="url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="http://your-docker-host:8765"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="text-xs text-gray-600 mt-1">The whisper pipeline API. Leave blank to use the default.</p>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={testing}
            className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors"
          >
            {testing ? "Connecting…" : "Connect"}
          </button>
        </form>
      </div>
    </div>
  );
}
