export function useSetup() {
  const jellyfinUrl = localStorage.getItem("jellyfilter:jellyfin_url");
  const apiKey = localStorage.getItem("jellyfilter:api_key");
  return {
    isConfigured: Boolean(jellyfinUrl && apiKey),
    jellyfinUrl: jellyfinUrl ?? "",
    apiKey: apiKey ?? "",
  };
}

export function saveSetup(jellyfinUrl: string, apiKey: string, apiUrl: string) {
  localStorage.setItem("jellyfilter:jellyfin_url", jellyfinUrl.replace(/\/$/, ""));
  localStorage.setItem("jellyfilter:api_key", apiKey);
  if (apiUrl.trim()) {
    localStorage.setItem("jellyfilter:api_url", apiUrl.replace(/\/$/, ""));
  }
}
