"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Wrench, Info, BookOpen, Server, ChevronsLeft } from "lucide-react";
import { getBackendUrl } from "@/lib/get-backend-url";

// Simple vertical nav structure
const SECTIONS = [
  { id: "logs", label: "Logs", icon: BookOpen },
  { id: "adaptations", label: "Adaptations", icon: BookOpen },
  { id: "mcp", label: "MCP Servers", icon: Server },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
  { id: "about", label: "About", icon: Info },
] as const;

export default function SettingsPage() {
  const [active, setActive] = useState<string>("logs");

  // Sync with URL query (?tab=tools)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab && SECTIONS.some(s => s.id === tab)) setActive(tab);
    else setActive("logs");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("tab", active);
    const url = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", url);
  }, [active]);

  // No tools configuration; tab removed.

  const [resetStatus, setResetStatus] = useState<"idle" | "resetting" | "done" | "error">("idle");
  const [buildInfo, setBuildInfo] = useState<{ commitId: string; commitMessage: string } | null>(null);

  useEffect(() => {
    fetch("/build-info.json")
      .then((res) => res.json())
      .then(setBuildInfo)
      .catch(() => {/* ignore */});
  }, []);

  // No general save flow; configuration is managed in agent configs.

  const handleResetSessions = async () => {
    if (resetStatus === "resetting") return;
    if (typeof window !== "undefined") {
      const ok = window.confirm("Reset all sessions? This will clear chat history and close all connections.");
      if (!ok) return;
    }
    setResetStatus("resetting");
    try {
      const res = await fetch(`${getBackendUrl()}/session/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatHistory: true, connections: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResetStatus("done");
      setTimeout(() => setResetStatus("idle"), 2500);
    } catch (e) {
      console.error("Reset sessions error", e);
      setResetStatus("error");
      setTimeout(() => setResetStatus("idle"), 3500);
    }
  };


  return (
    <div className="flex flex-col md:flex-row h-[calc(100dvh-64px)]">{/* reserve space for top bar height approx */}
      {/* Left nav (desktop) */}
      <aside className="hidden md:block w-64 border-r p-4 space-y-2">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant={active === id ? "secondary" : "ghost"}
            className="w-full justify-start"
            onClick={() => setActive(id)}
          >
            <Icon className="w-4 h-4 mr-2" />
            {label}
          </Button>
        ))}
      </aside>

      {/* Content */}
      <main className="flex-1 p-3 sm:p-6">
        {/* Back to Chat */}
        <div className="flex justify-end mb-3">
          <Button variant="ghost" asChild>
            <Link href="/" className="flex items-center gap-2"><ChevronsLeft className="w-4 h-4" /> Back to Chat</Link>
          </Button>
        </div>
        {/* Mobile section switcher */}
        <div className="md:hidden mb-3">
          <Select value={active} onValueChange={setActive}>
            <SelectTrigger>
              <SelectValue placeholder="Choose section" />
            </SelectTrigger>
            <SelectContent>
              {SECTIONS.map(({ id, label }) => (
                <SelectItem key={id} value={id}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ScrollArea className="h-[calc(100dvh-64px-80px)] md:h-[calc(100dvh-64px-32px)] pr-2">
          {/* General tab removed: instructions and voice settings are managed in agent configs. */}

          {active === "logs" && (
            <Card className="w-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Logs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border overflow-hidden">
                  <iframe src="/logs" className="w-full h-[65vh]" />
                </div>
              </CardContent>
            </Card>
          )}

          {active === "adaptations" && (
            <Card className="w-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Adaptations</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border overflow-hidden">
                  <iframe src="/adaptations" className="w-full h-[65vh]" />
                </div>
              </CardContent>
            </Card>
          )}

          {active === "mcp" && (
            <Card className="w-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">MCP Servers</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border overflow-hidden">
                  <iframe src="/mcp-servers" className="w-full h-[65vh]" />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tools and Voice tabs removed */}

          {active === "maintenance" && (
            <Card className="w-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Maintenance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={handleResetSessions}
                  disabled={resetStatus === "resetting"}
                >
                  {resetStatus === "resetting" ? "Resetting..." :
                   resetStatus === "done" ? "Reset Complete" :
                   resetStatus === "error" ? "Reset Failed" : "Reset All Sessions"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Closes active connections (voice, chat, observability) and clears server-side chat history.
                </p>
              </CardContent>
            </Card>
          )}

          {active === "about" && (
            <Card className="w-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">About</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {buildInfo && (
                  <div className="text-xs text-muted-foreground">
                    <div>Commit {buildInfo.commitId}</div>
                    <div>{buildInfo.commitMessage}</div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </ScrollArea>
      </main>

      {/* Tools dialog removed */}
    </div>
  );
}
