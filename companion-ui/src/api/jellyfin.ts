const getBase = () => localStorage.getItem("jellyfilter:jellyfin_url") ?? "";
const getKey = () => localStorage.getItem("jellyfilter:api_key") ?? "";

function headers() {
  return {
    "X-Emby-Token": getKey(),
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${getBase()}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: headers() });
  if (!res.ok) throw new Error(`Jellyfin ${path}: ${res.status}`);
  return res.json();
}

export interface JellyfinItem {
  Id: string;
  Name: string;
  Type: string;
  ProductionYear?: number;
  ImageTags?: { Primary?: string };
  SeriesName?: string;
  Path?: string;
}

export async function fetchLibraryItems(): Promise<JellyfinItem[]> {
  const data = await get<{ Items: JellyfinItem[] }>("/Items", {
    Recursive: "true",
    IncludeItemTypes: "Movie,Series",
    Fields: "ImageTags,SeriesName,Path",
    Limit: "2000",
    SortBy: "SortName",
    SortOrder: "Ascending",
  });
  const items = data.Items ?? [];
  // Deduplicate by Name+Year — Jellyfin returns one item per video file,
  // so multi-version movies and home video folders create duplicates.
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.Name}||${item.ProductionYear ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchUsers() {
  return get<Array<{ Id: string; Name: string }>>("/Users");
}

export function getImageUrl(itemId: string, tag: string) {
  return `${getBase()}/Items/${itemId}/Images/Primary?tag=${tag}&maxWidth=300`;
}
