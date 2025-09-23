"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { Wrench, Info, BookOpen, Server, ChevronsLeft, Boxes } from "lucide-react";
import { getBackendUrl } from "@/lib/get-backend-url";

type CatalogTool = {
  id: string;
  name: string;
  sanitizedName: string;
  origin: string;
  tags: string[];
  description?: string;
};

type AgentPolicy = {
  allowNames?: string[];
  allowTags?: string[];
  denyNames?: string[];
  denyTags?: string[];
};

type AgentDebugEntry = {
  policy: AgentPolicy;
  tools: string[];
};

type AgentsDebugResponse = Record<string, AgentDebugEntry>;

type AgentToolSchema =
  | { type: "web_search" }
  | {
      type: "function";
      name: string;
      description: string;
      parameters: unknown;
      strict: boolean;
    };

// Simple vertical nav structure
const SECTIONS = [
  { id: "logs", label: "Logs", icon: BookOpen },
  { id: "catalog", label: "Tools", icon: Boxes },
  { id: "adaptations", label: "Adaptations", icon: BookOpen },
  { id: "mcp", label: "MCP Servers", icon: Server },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
  { id: "about", label: "About", icon: Info },
] as const;

const formatAgentLabel = (agentId: string) =>
  agentId
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || agentId;

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

  const [catalogTools, setCatalogTools] = useState<CatalogTool[]>([]);
  const [catalogLoading, setCatalogLoading] = useState<boolean>(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [agentsInfo, setAgentsInfo] = useState<AgentsDebugResponse>({});
  const [agentsLoading, setAgentsLoading] = useState<boolean>(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [agentSchemas, setAgentSchemas] = useState<Record<string, AgentToolSchema[]>>({});
  const [agentSchemaErrors, setAgentSchemaErrors] = useState<Record<string, string>>({});

  const catalogSectionRef = useRef<HTMLDivElement | null>(null);
  const agentSectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const sortedAgents = useMemo(
    () =>
      Object.entries(agentsInfo).sort(([a], [b]) => {
        if (a === b) return 0;
        if (a === "base") return -1;
        if (b === "base") return 1;
        if (a === "supervisor") return -1;
        if (b === "supervisor") return 1;
        return a.localeCompare(b);
      }),
    [agentsInfo]
  );

  const scrollToSection = (sectionId: "catalog" | string) => {
    const target =
      sectionId === "catalog"
        ? catalogSectionRef.current
        : agentSectionRefs.current[sectionId];

    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  useEffect(() => {
    let cancelled = false;
    const backendUrl = getBackendUrl();

    const loadCatalog = async () => {
      setCatalogLoading(true);
      setCatalogError(null);
      try {
        const res = await fetch(`${backendUrl}/catalog/tools`);
        if (!res.ok) {
          throw new Error(`Failed to load tool catalog (HTTP ${res.status})`);
        }
        const data = (await res.json()) as CatalogTool[];
        if (!cancelled) {
          setCatalogTools(data);
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error("Failed to load tool catalog", err);
        setCatalogError(err?.message || "Failed to load tool catalog");
        setCatalogTools([]);
      } finally {
        if (!cancelled) {
          setCatalogLoading(false);
        }
      }
    };

    const loadAgents = async () => {
      setAgentsLoading(true);
      setAgentsError(null);
      setAgentSchemaErrors({});
      try {
        const res = await fetch(`${backendUrl}/agents`);
        if (!res.ok) {
          throw new Error(`Failed to load agents (HTTP ${res.status})`);
        }
        const data = (await res.json()) as AgentsDebugResponse;
        if (cancelled) return;
        setAgentsInfo(data);

        const schemaData: Record<string, AgentToolSchema[]> = {};
        const schemaErrors: Record<string, string> = {};

        await Promise.all(
          Object.keys(data).map(async (agentId) => {
            try {
              const schemaRes = await fetch(`${backendUrl}/agents/${agentId}/tools`);
              if (!schemaRes.ok) {
                throw new Error(`Failed to load tools (HTTP ${schemaRes.status})`);
              }
              const schemaJson = (await schemaRes.json()) as AgentToolSchema[];
              schemaData[agentId] = schemaJson;
            } catch (schemaErr: any) {
              schemaErrors[agentId] = schemaErr?.message || "Failed to load tools for agent";
            }
          })
        );

        if (!cancelled) {
          setAgentSchemas(schemaData);
          setAgentSchemaErrors(schemaErrors);
        }
      } catch (err: any) {
        if (cancelled) return;
        console.error("Failed to load agents", err);
        setAgentsError(err?.message || "Failed to load agents");
        setAgentsInfo({});
        setAgentSchemas({});
      } finally {
        if (!cancelled) {
          setAgentsLoading(false);
        }
      }
    };

    void loadCatalog();
    void loadAgents();

    return () => {
      cancelled = true;
    };
  }, []);

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

          {active === "catalog" && (
            <Card className="w-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Tool Catalogue</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 text-sm">
                {(sortedAgents.length > 0 || catalogTools.length > 0) && (
                  <div className="sticky top-0 z-10 rounded-md border bg-card/95 p-3 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Jump to section
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => scrollToSection("catalog")}
                      >
                        Tool Catalogue
                      </Button>
                      {sortedAgents.map(([agentId]) => (
                        <Button
                          key={`toc-${agentId}`}
                          type="button"
                          size="sm"
                          variant={
                            agentId === "base" || agentId === "supervisor"
                              ? "secondary"
                              : "outline"
                          }
                          onClick={() => scrollToSection(agentId)}
                        >
                          {formatAgentLabel(agentId)} Agent
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Read-only view of the tool registry resolved from the backend along with agent policies and assigned tools.
                </p>

                <div
                  ref={catalogSectionRef}
                  id="settings-tools-catalogue"
                  className="space-y-2 scroll-mt-24"
                >
                  <h3 className="text-sm font-medium">Registered tools</h3>
                  {catalogLoading && (
                    <p className="text-xs text-muted-foreground">Loading tools…</p>
                  )}
                  {!catalogLoading && catalogError && (
                    <p className="text-xs text-destructive">{catalogError}</p>
                  )}
                  {!catalogLoading && !catalogError && (
                    <div className="rounded-md border divide-y">
                      {catalogTools.length === 0 && (
                        <div className="p-3 text-xs text-muted-foreground">No tools discovered.</div>
                      )}
                      {catalogTools.map((tool) => (
                        <div key={tool.id} className="p-3 space-y-2">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                            <div className="font-medium">{tool.name}</div>
                            <code className="text-xs text-muted-foreground">{tool.id}</code>
                          </div>
                          {tool.description ? (
                            <p className="text-xs text-muted-foreground">{tool.description}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">No description</p>
                          )}
                          <div className="flex flex-wrap gap-2 text-[11px]">
                            <span className="rounded border bg-muted px-2 py-0.5 uppercase tracking-wide text-[10px] text-muted-foreground">
                              {tool.origin}
                            </span>
                            {tool.tags.map((tag) => (
                              <span key={`${tool.id}-${tag}`} className="rounded border px-2 py-0.5">
                                {tag}
                              </span>
                            ))}
                            <span className="rounded border px-2 py-0.5">{tool.sanitizedName}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <h3 className="text-sm font-medium">Agents</h3>
                  {agentsLoading && <p className="text-xs text-muted-foreground">Loading agent mappings…</p>}
                  {!agentsLoading && agentsError && (
                    <p className="text-xs text-destructive">{agentsError}</p>
                  )}
                  {!agentsLoading && !agentsError && (
                    <div className="space-y-3">
                      {sortedAgents.map(([agentId, entry]) => (
                        <div
                          key={agentId}
                          id={`agent-${agentId}`}
                          ref={(node) => {
                            agentSectionRefs.current[agentId] = node;
                          }}
                          className="rounded-md border p-3 space-y-3 scroll-mt-24"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                            <div className="font-medium">{formatAgentLabel(agentId)} Agent</div>
                            <div className="text-xs text-muted-foreground">
                              {entry.tools.length} resolved tool{entry.tools.length === 1 ? "" : "s"}
                            </div>
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <p className="text-xs font-semibold">Allow names</p>
                              <div className="flex flex-wrap gap-2">
                                {entry.policy.allowNames?.length ? (
                                  entry.policy.allowNames.map((name) => (
                                    <span key={`${agentId}-allow-${name}`} className="rounded border px-2 py-0.5 text-xs">
                                      {name}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-xs text-muted-foreground">None</span>
                                )}
                              </div>
                              <p className="text-xs font-semibold">Allow tags</p>
                              <div className="flex flex-wrap gap-2">
                                {entry.policy.allowTags?.length ? (
                                  entry.policy.allowTags.map((tag) => (
                                    <span key={`${agentId}-allow-tag-${tag}`} className="rounded border px-2 py-0.5 text-xs">
                                      {tag}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-xs text-muted-foreground">None</span>
                                )}
                              </div>
                            </div>

                            <div className="space-y-2">
                              <p className="text-xs font-semibold">Deny names</p>
                              <div className="flex flex-wrap gap-2">
                                {entry.policy.denyNames?.length ? (
                                  entry.policy.denyNames.map((name) => (
                                    <span key={`${agentId}-deny-${name}`} className="rounded border px-2 py-0.5 text-xs">
                                      {name}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-xs text-muted-foreground">None</span>
                                )}
                              </div>
                              <p className="text-xs font-semibold">Deny tags</p>
                              <div className="flex flex-wrap gap-2">
                                {entry.policy.denyTags?.length ? (
                                  entry.policy.denyTags.map((tag) => (
                                    <span key={`${agentId}-deny-tag-${tag}`} className="rounded border px-2 py-0.5 text-xs">
                                      {tag}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-xs text-muted-foreground">None</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className="text-xs font-semibold">Resolved tool identifiers</p>
                            <div className="flex flex-wrap gap-2">
                              {entry.tools.length ? (
                                entry.tools.map((tool) => (
                                  <span key={`${agentId}-resolved-${tool}`} className="rounded border px-2 py-0.5 text-xs">
                                    {tool}
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground">No tools resolved</span>
                              )}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className="text-xs font-semibold">Responses API payload</p>
                            {agentSchemaErrors[agentId] ? (
                              <p className="text-xs text-destructive">{agentSchemaErrors[agentId]}</p>
                            ) : (
                              <pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-[11px] overflow-x-auto">
                                {JSON.stringify(agentSchemas[agentId] || [], null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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
