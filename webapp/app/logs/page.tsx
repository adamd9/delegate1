export const dynamic = "force-dynamic";

import LogViewer from "@/components/LogViewer";

export default function LogsPage() {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] w-full flex-col items-stretch p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Backend Logs</h1>
        <a
          href="/api/backend-logs"
          className="text-sm text-blue-600 hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          Raw /api/backend-logs
        </a>
      </div>
      <div className="flex-1 overflow-hidden rounded border border-gray-200 bg-white dark:border-gray-800 dark:bg-neutral-900">
        <LogViewer />
      </div>
    </main>
  );
}
