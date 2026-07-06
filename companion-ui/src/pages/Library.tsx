import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchItemStatus, fetchPipeline } from "../api/jellyfilter";
import { getImageUrl, type JellyfinItem } from "../api/jellyfin";

type FilterStatus = "filtered" | "pending" | "no-data";
type ActiveFilter = "all" | FilterStatus;

const FILTER_LABELS: Record<ActiveFilter, string> = {
  all: "All",
  filtered: "Filtered",
  pending: "Pending",
  "no-data": "No Data",
};

const BADGE_STYLES: Record<FilterStatus, string> = {
  filtered: "bg-green-900 text-green-300",
  pending: "bg-yellow-900 text-yellow-300",
  "no-data": "bg-gray-800 text-gray-400",
};

function StatusBadge({ status }: { status: FilterStatus }) {
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${BADGE_STYLES[status]}`}>
      {FILTER_LABELS[status]}
    </span>
  );
}

function ItemCard({ item, status }: { item: JellyfinItem; status: FilterStatus }) {
  const imageTag = item.ImageTags?.Primary;

  return (
    <Link to={`/library/${item.Id}`} className="block group">
      <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden group-hover:border-gray-600 transition-colors">
        <div className="aspect-[2/3] bg-gray-800 relative">
          {imageTag ? (
            <img
              src={getImageUrl(item.Id, imageTag)}
              alt={item.Name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">
              No Image
            </div>
          )}
          <div className="absolute top-2 right-2">
            <StatusBadge status={status} />
          </div>
        </div>
        <div className="p-2">
          <p className="text-sm font-medium text-white truncate">{item.Name}</p>
          {item.SeriesName && (
            <p className="text-xs text-gray-400 truncate">{item.SeriesName}</p>
          )}
          {item.ProductionYear && (
            <p className="text-xs text-gray-500">{item.ProductionYear}</p>
          )}
        </div>
      </div>
    </Link>
  );
}

export function Library({ items }: { items: JellyfinItem[] }) {
  const [filter, setFilter] = useState<ActiveFilter>("all");

  const { data: pipeline, isLoading: pipelineLoading } = useQuery({
    queryKey: ["pipeline"],
    queryFn: fetchPipeline,
  });

  const scanPaths = pipeline?.media_paths ?? [];

  // Wait for pipeline to load before filtering so we don't flash all items
  // then immediately hide most of them.
  const scopedItems = pipelineLoading
    ? []
    : scanPaths.length === 0
    ? items
    : items.filter((item) => {
        if (!item.Path) return false;
        // Normalize: strip trailing slash so both "/foo" and "/foo/" work as prefixes,
        // then require a "/" boundary so "/mnt/Movies" doesn't match "/mnt/MoviesExtra".
        return scanPaths.some((p) => {
          const prefix = p.replace(/\/$/, "");
          return item.Path === prefix || item.Path!.startsWith(prefix + "/");
        });
      });

  const statusQueries = useQueries({
    queries: scopedItems.map((item) => ({
      queryKey: ["item-status", item.Id],
      queryFn: () => fetchItemStatus(item.Id),
      retry: false,
    })),
  });

  const statusMap = new Map<string, FilterStatus>(
    scopedItems.map((item, i) => {
      const data = statusQueries[i].data;
      const status: FilterStatus = data?.status === "done" ? "filtered"
        : data ? "pending"
        : "no-data";
      return [item.Id, status];
    })
  );

  const counts: Record<FilterStatus, number> = { filtered: 0, pending: 0, "no-data": 0 };
  for (const s of statusMap.values()) counts[s]++;

  const visibleItems = filter === "all"
    ? scopedItems
    : scopedItems.filter((item) => statusMap.get(item.Id) === filter);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="text-lg font-semibold mr-auto">Library</h1>
        <div className="flex gap-1">
          {(["all", "filtered", "pending", "no-data"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-violet-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
              }`}
            >
              {FILTER_LABELS[f]}
              {f !== "all" && (
                <span className="ml-1.5 opacity-60">{counts[f]}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {scanPaths.length > 0 && (
        <p className="text-xs text-gray-600 mb-3">
          Showing items under:{" "}
          {scanPaths.map((p, i) => (
            <span key={p}>
              <span className="font-mono text-gray-500">{p}</span>
              {i < scanPaths.length - 1 ? ", " : ""}
            </span>
          ))}
          {" · "}
          <span className="text-gray-500">{scopedItems.length} of {items.length} items</span>
        </p>
      )}

      {pipelineLoading && <p className="text-gray-500 text-sm">Loading…</p>}
      {!pipelineLoading && scopedItems.length === 0 && items.length === 0 && <p className="text-gray-400">Loading library…</p>}
      {!pipelineLoading && scopedItems.length === 0 && items.length > 0 && (
        <p className="text-gray-500 text-sm">
          No items match the configured scan paths. Check Preferences → Scan Paths and make sure they match the absolute paths Jellyfin uses (e.g. <span className="font-mono">/mnt/media/Movies</span>).
        </p>
      )}
      {visibleItems.length === 0 && items.length > 0 && (
        <p className="text-gray-500 text-sm">No items match this filter.</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
        {visibleItems.map((item) => (
          <ItemCard key={item.Id} item={item} status={statusMap.get(item.Id) ?? "no-data"} />
        ))}
      </div>
    </div>
  );
}
