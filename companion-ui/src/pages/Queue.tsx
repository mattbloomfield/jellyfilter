import { useQuery } from "@tanstack/react-query";
import { fetchQueue, type QueueItem } from "../api/jellyfilter";

const STATUS_STYLES: Record<string, string> = {
  new: "bg-gray-800 text-gray-300",
  processing: "bg-blue-900 text-blue-300 animate-pulse",
  done: "bg-green-900 text-green-300",
  failed: "bg-red-900 text-red-300",
};

function fmt(epoch: number | null): string {
  if (!epoch) return "—";
  return new Date(epoch * 1000).toLocaleString();
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export function Queue() {
  const { data: items, isLoading, error } = useQuery({
    queryKey: ["queue"],
    queryFn: fetchQueue,
    refetchInterval: 10_000,
  });

  if (isLoading) return <p className="text-gray-400">Loading queue…</p>;
  if (error) return <p className="text-red-400">Failed to load queue.</p>;

  return (
    <div>
      <h1 className="text-lg font-semibold mb-4">Processing Queue</h1>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-400">
              <th className="pb-2 font-medium">File</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium">Hits</th>
              <th className="pb-2 font-medium">Added</th>
              <th className="pb-2 font-medium">Finished</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((item: QueueItem) => (
              <tr key={item.id} className="border-b border-gray-900 hover:bg-gray-900">
                <td className="py-2 pr-4 max-w-xs">
                  <span className="block truncate text-white" title={item.media_path}>
                    {basename(item.media_path)}
                  </span>
                  {item.error_message && (
                    <span className="text-red-400 text-xs block truncate" title={item.error_message}>
                      {item.error_message}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      STATUS_STYLES[item.status] ?? "bg-gray-800 text-gray-400"
                    }`}
                  >
                    {item.status}
                  </span>
                </td>
                <td className="py-2 pr-4 text-gray-300">
                  {item.hit_count != null ? item.hit_count : "—"}
                </td>
                <td className="py-2 pr-4 text-gray-400 text-xs">{fmt(item.added_at)}</td>
                <td className="py-2 text-gray-400 text-xs">{fmt(item.finished_at)}</td>
              </tr>
            ))}
            {!items?.length && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-gray-500">
                  Queue is empty.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
