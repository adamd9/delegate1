export const dynamic = "force-dynamic";

import LogViewer from "@/components/LogViewer";
import { getBackendUrl } from "@/lib/get-backend-url";

export default function LogsPage() {
  const envBackend = process.env.NEXT_PUBLIC_REMOTE_BACKEND;
  const backendBase = getBackendUrl().replace(/\/$/, "");
  const rawHref = `${backendBase}/logs`;
  const rawLabel = `Raw ${rawHref}`;
  return (
    <main className="flex min-h-[calc(100vh-4rem)] w-full flex-col items-stretch p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Backend Logs</h1>
        <a
          href={rawHref}
          className="text-sm text-blue-600 hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          {rawLabel}
        </a>
      </div>
      <details className="mb-3 text-xs text-gray-600 dark:text-gray-300">
        <summary className="cursor-pointer select-none">Debug</summary>
        <div className="mt-2 space-y-1">
          <div><span className="font-semibold">Resolved backend:</span> {backendBase}</div>
          <div><span className="font-semibold">NEXT_PUBLIC_REMOTE_BACKEND:</span> {envBackend || "(unset)"}</div>
        </div>
      </details>
      <div className="flex-1 overflow-hidden rounded border border-gray-200 bg-white dark:border-gray-800 dark:bg-neutral-900">
        <LogViewer />
      </div>
    </main>
  );
}
