import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { fetchItemStatus } from "../api/jellyfilter";
import { getImageUrl, type JellyfinItem } from "../api/jellyfin";

type FilterStatus = "filtered" | "pending" | "no-data";

function StatusBadge({ status }: { status: FilterStatus }) {
  const styles: Record<FilterStatus, string> = {
    filtered: "bg-green-900 text-green-300",
    pending: "bg-yellow-900 text-yellow-300",
    "no-data": "bg-gray-800 text-gray-400",
  };
  const labels: Record<FilterStatus, string> = {
    filtered: "Filtered",
    pending: "Pending",
    "no-data": "No Data",
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function ItemCard({ item }: { item: JellyfinItem }) {
  const { data: statusData } = useQuery({
    queryKey: ["item-status", item.Id],
    queryFn: () => fetchItemStatus(item.Id),
    retry: false,
  });

  let filterStatus: FilterStatus = "no-data";
  if (statusData) {
    filterStatus = statusData.status === "done" ? "filtered" : "pending";
  }

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
            <StatusBadge status={filterStatus} />
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
  return (
    <div>
      <h1 className="text-lg font-semibold mb-4">Library</h1>
      {items.length === 0 && <p className="text-gray-400">Loading library…</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
        {items.map((item) => <ItemCard key={item.Id} item={item} />)}
      </div>
    </div>
  );
}
