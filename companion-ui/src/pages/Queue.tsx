import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchQueue, retryQueueItem, type QueueItem } from "../api/jellyfilter";

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

function fmtEta(seconds: number): string {
  if (seconds < 90) return `~${Math.round(seconds)}s`;
  if (seconds < 3600) return `~${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `~${h}h ${m}m`;
}

function RetryButton({ item }: { item: QueueItem }) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => retryQueueItem(item.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });
  return (
    <button
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
      className="text-xs text-violet-400 hover:text-violet-300 disabled:opacity-50 transition-colors"
    >
      {mutation.isPending ? "Retrying…" : "Retry"}
    </button>
  );
}

export function Queue() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["queue"],
    queryFn: fetchQueue,
    refetchInterval: 10_000,
  });

  if (isLoading) return <p className="text-gray-400">Loading queue…</p>;
  if (error) return <p className="text-red-400">Failed to load queue.</p>;

  const items = data?.items ?? [];
  const { pending, eta_seconds } = data ?? { pending: 0, eta_seconds: null };

  return (
    <div>
      <div className="flex items-center gap-4 mb-4">
        <h1 className="text-lg font-semibold">Processing Queue</h1>
        {pending > 0 && (
          <span className="text-sm text-gray-400">
            {pending} pending
            {eta_seconds != null && (
              <span className="ml-1 text-violet-400">&middot; {fmtEta(eta_seconds)} remaining</span>
            )}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-400">
              <th className="pb-2 font-medium">File</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium">Hits</th>
              <th className="pb-2 font-medium">Added</th>
              <th className="pb-2 font-medium">Finished</th>
              <th className="pb-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: QueueItem) => (
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
                  {item.retry_count > 0 && (
                    <span className="text-gray-500 text-xs">{item.retry_count} previous attempt{item.retry_count !== 1 ? "s" : ""}</span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[item.status] ?? "bg-gray-800 text-gray-400"}`}>
                    {item.status}
                  </span>
                </td>
                <td className="py-2 pr-4 text-gray-300">
                  {item.hit_count != null ? item.hit_count : "—"}
                </td>
                <td className="py-2 pr-4 text-gray-400 text-xs">{fmt(item.added_at)}</td>
                <td className="py-2 pr-4 text-gray-400 text-xs">{fmt(item.finished_at)}</td>
                <td className="py-2 text-right">
                  {item.status === "failed" && <RetryButton item={item} />}
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-500">
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
