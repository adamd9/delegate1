"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import ThoughtflowD2Viewer from "@/components/ThoughtflowD2Viewer";

function ViewerContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  if (!id) {
    return <div className="p-8 text-gray-500">No thoughtflow ID specified.</div>;
  }
  return (
    <div className="h-screen">
      <ThoughtflowD2Viewer id={id} />
    </div>
  );
}

export default function ThoughtflowViewerPage() {
  return (
    <Suspense fallback={<div className="p-8 text-gray-400">Loading…</div>}>
      <ViewerContent />
    </Suspense>
  );
}
