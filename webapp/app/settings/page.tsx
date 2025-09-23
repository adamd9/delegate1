"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const sortNames = (names: string[]) => [...names].sort((a, b) => a.localeCompare(b));

const arraysEqualIgnoringOrder = (a: string[] = [], b: string[] = []) => {
  if (a.length !== b.length) return false;
  const sortedA = sortNames(a);
  const sortedB = sortNames(b);
  return sortedA.every((value, index) => value === sortedB[index]);
};

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
  const [allowNameDrafts, setAllowNameDrafts] = useState<Record<string, string[]>>({});
  const [allowNameSaveState, setAllowNameSaveState] = useState<
    Record<string, "idle" | "saving" | "success" | "error">
  >({});
  const [allowNameSaveErrors, setAllowNameSaveErrors] = useState<Record<string, string | null>>({});
  const [selectResetCounters, setSelectResetCounters] = useState<Record<string, number>>({});

  const catalogSectionRef = useRef<HTMLDivElement | null>(null);
  const agentSectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cancelRef = useRef(false);

  const backendUrl = useMemo(() => getBackendUrl(), []);

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

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const res = await fetch(`${backendUrl}/catalog/tools`);
      if (!res.ok) {
        throw new Error(`Failed to load tool catalog (HTTP ${res.status})`);
      }
      const data = (await res.json()) as CatalogTool[];
      if (cancelRef.current) return;
      setCatalogTools(data);
    } catch (err: any) {
      if (cancelRef.current) return;
      console.error("Failed to load tool catalog", err);
      setCatalogError(err?.message || "Failed to load tool catalog");
      setCatalogTools([]);
    } finally {
      if (cancelRef.current) return;
      setCatalogLoading(false);
    }
  }, [backendUrl]);

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    setAgentsError(null);
    setAgentSchemaErrors({});
    try {
      const res = await fetch(`${backendUrl}/agents`);
      if (!res.ok) {
        throw new Error(`Failed to load agents (HTTP ${res.status})`);
      }
      const data = (await res.json()) as AgentsDebugResponse;
      if (cancelRef.current) return;
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

      if (cancelRef.current) return;
      setAgentSchemas(schemaData);
      setAgentSchemaErrors(schemaErrors);

      const drafts: Record<string, string[]> = {};
      const agentIds = Object.keys(data);
      for (const [agentId, entry] of Object.entries(data)) {
        const names = entry.policy.allowNames ? [...entry.policy.allowNames] : [];
        drafts[agentId] = sortNames(names);
      }
      setAllowNameDrafts(drafts);
      setAllowNameSaveState((prev) => {
        const next: Record<string, "idle" | "saving" | "success" | "error"> = {};
        agentIds.forEach((agentId) => {
          next[agentId] = prev[agentId] ?? "idle";
        });
        return next;
      });
      setAllowNameSaveErrors((prev) => {
        const next: Record<string, string | null> = {};
        agentIds.forEach((agentId) => {
          next[agentId] = prev[agentId] ?? null;
        });
        return next;
      });
      setSelectResetCounters((prev) => {
        const next: Record<string, number> = {};
        agentIds.forEach((agentId) => {
          next[agentId] = prev[agentId] ?? 0;
        });
        return next;
      });
    } catch (err: any) {
      if (cancelRef.current) return;
      console.error("Failed to load agents", err);
      setAgentsError(err?.message || "Failed to load agents");
      setAgentsInfo({});
      setAgentSchemas({});
      setAllowNameDrafts({});
      setAllowNameSaveState({});
      setAllowNameSaveErrors({});
      setSelectResetCounters({});
    } finally {
      if (cancelRef.current) return;
      setAgentsLoading(false);
    }
  }, [backendUrl]);

  useEffect(() => {
    cancelRef.current = false;
    void loadCatalog();
    void loadAgents();
    return () => {
      cancelRef.current = true;
    };
  }, [loadCatalog, loadAgents]);

  const modifyAllowNames = useCallback(
    (agentId: string, updater: (current: string[]) => string[]) => {
      setAllowNameDrafts((prev) => {
        const original = prev[agentId] ? [...prev[agentId]] : [];
        const updated = updater([...original]);
        const nextValues = sortNames(updated);
        if (arraysEqualIgnoringOrder(original, nextValues)) {
          return prev;
        }
        return { ...prev, [agentId]: nextValues };
      });
      setAllowNameSaveState((prev) => {
        const status = prev[agentId];
        if (status === "saving") return prev;
        return { ...prev, [agentId]: "idle" };
      });
      setAllowNameSaveErrors((prev) => ({ ...prev, [agentId]: null }));
    },
    []
  );

  const handleAddAllowName = useCallback(
    (agentId: string, name: string) => {
      if (!name) return;
      const existing = allowNameDrafts[agentId] ?? [];
      if (existing.includes(name)) return;
      modifyAllowNames(agentId, (current) => {
        current.push(name);
        return current;
      });
      setSelectResetCounters((prev) => ({
        ...prev,
        [agentId]: (prev[agentId] ?? 0) + 1,
      }));
    },
    [allowNameDrafts, modifyAllowNames]
  );

  const handleRemoveAllowName = useCallback(
    (agentId: string, name: string) => {
      modifyAllowNames(agentId, (current) => current.filter((value) => value !== name));
    },
    [modifyAllowNames]
  );

  const handleResetAllowNames = useCallback(
    (agentId: string) => {
      const original = agentsInfo[agentId]?.policy.allowNames ?? [];
      setAllowNameDrafts((prev) => ({
        ...prev,
        [agentId]: sortNames([...original]),
      }));
      setAllowNameSaveState((prev) => ({ ...prev, [agentId]: "idle" }));
      setAllowNameSaveErrors((prev) => ({ ...prev, [agentId]: null }));
      setSelectResetCounters((prev) => ({
        ...prev,
        [agentId]: (prev[agentId] ?? 0) + 1,
      }));
    },
    [agentsInfo]
  );

  const handleSaveAllowNames = useCallback(
    async (agentId: string) => {
      const names = allowNameDrafts[agentId] ?? [];
      setAllowNameSaveState((prev) => ({ ...prev, [agentId]: "saving" }));
      setAllowNameSaveErrors((prev) => ({ ...prev, [agentId]: null }));
      try {
        const res = await fetch(`${backendUrl}/agents/${agentId}/policy`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ allowNames: names }),
        });
        if (!res.ok) {
          let errorMessage = `Failed to update allow names (HTTP ${res.status})`;
          try {
            const payload = (await res.json()) as { error?: string };
            if (payload?.error) errorMessage = payload.error;
          } catch {
            // ignore JSON parse errors
          }
          throw new Error(errorMessage);
        }
        const payload = (await res.json()) as { agent?: AgentDebugEntry };
        if (!payload?.agent) {
          throw new Error("Unexpected response from server");
        }
        if (cancelRef.current) return;

        setAgentsInfo((prev) => ({ ...prev, [agentId]: payload.agent! }));
        const updatedNames = payload.agent.policy.allowNames
          ? [...payload.agent.policy.allowNames]
          : [];
        setAllowNameDrafts((prev) => ({
          ...prev,
          [agentId]: sortNames(updatedNames),
        }));
        setAllowNameSaveState((prev) => ({ ...prev, [agentId]: "success" }));
        setAllowNameSaveErrors((prev) => ({ ...prev, [agentId]: null }));

        try {
          const schemaRes = await fetch(`${backendUrl}/agents/${agentId}/tools`);
          if (!schemaRes.ok) {
            throw new Error(`Failed to load tools (HTTP ${schemaRes.status})`);
          }
          const schemaJson = (await schemaRes.json()) as AgentToolSchema[];
          if (!cancelRef.current) {
            setAgentSchemas((prev) => ({ ...prev, [agentId]: schemaJson }));
            setAgentSchemaErrors((prev) => {
              const next = { ...prev };
              delete next[agentId];
              return next;
            });
          }
        } catch (schemaErr: any) {
          if (!cancelRef.current) {
            setAgentSchemaErrors((prev) => ({
              ...prev,
              [agentId]: schemaErr?.message || "Failed to load tools for agent",
            }));
          }
        }
      } catch (err: any) {
        if (cancelRef.current) return;
        setAllowNameSaveState((prev) => ({ ...prev, [agentId]: "error" }));
        setAllowNameSaveErrors((prev) => ({
          ...prev,
          [agentId]: err?.message || "Failed to update allow names",
        }));
      }
    },
    [allowNameDrafts, backendUrl]
  );

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
                      {sortedAgents.map(([agentId, entry]) => {
                        const draftAllowNames = allowNameDrafts[agentId] ?? [];
                        const availableTools = catalogTools
                          .filter((tool) => !draftAllowNames.includes(tool.name))
                          .sort((a, b) => a.name.localeCompare(b.name));
                        const allowListChanged = !arraysEqualIgnoringOrder(
                          entry.policy.allowNames ?? [],
                          draftAllowNames
                        );
                        const saveStatus = allowNameSaveState[agentId] ?? "idle";
                        const saveError = allowNameSaveErrors[agentId];
                        const selectKey = selectResetCounters[agentId] ?? 0;

                        return (
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

                            <div className="space-y-4">
                              <div className="space-y-2">
                                <p className="text-xs font-semibold">Allow names</p>
                                <div className="flex flex-wrap gap-2">
                                  {draftAllowNames.length ? (
                                    draftAllowNames.map((name) => (
                                      <span
                                        key={`${agentId}-allow-${name}`}
                                        className="flex items-center gap-1 rounded border px-2 py-0.5 text-xs"
                                      >
                                        {name}
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveAllowName(agentId, name)}
                                          className="text-muted-foreground transition-colors hover:text-destructive"
                                          aria-label={`Remove ${name} from allow list`}
                                        >
                                          ×
                                        </button>
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-xs text-muted-foreground">None</span>
                                  )}
                                </div>
                                {catalogLoading ? (
                                  <p className="text-xs text-muted-foreground">Tool catalog loading…</p>
                                ) : catalogError ? (
                                  <p className="text-xs text-destructive">
                                    Tool catalog unavailable: {catalogError}
                                  </p>
                                ) : availableTools.length ? (
                                  <Select
                                    key={`select-${agentId}-${selectKey}`}
                                    onValueChange={(value) => handleAddAllowName(agentId, value)}
                                  >
                                    <SelectTrigger className="w-full max-w-xs sm:w-auto">
                                      <SelectValue placeholder="Add tool to allow list" />
                                    </SelectTrigger>
                                    <SelectContent className="max-h-64">
                                      {availableTools.map((tool) => (
                                        <SelectItem key={`${agentId}-add-${tool.name}`} value={tool.name}>
                                          <div className="flex flex-col">
                                            <span>{tool.name}</span>
                                            <span className="text-[11px] text-muted-foreground">
                                              {tool.sanitizedName}
                                            </span>
                                          </div>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : (
                                  <p className="text-xs text-muted-foreground">
                                    All catalog tools are currently allowed.
                                  </p>
                                )}
                                <div className="flex flex-wrap items-center gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() => handleSaveAllowNames(agentId)}
                                    disabled={!allowListChanged || saveStatus === "saving"}
                                  >
                                    {saveStatus === "saving" ? "Saving…" : "Save allow list"}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleResetAllowNames(agentId)}
                                    disabled={!allowListChanged || saveStatus === "saving"}
                                  >
                                    Reset
                                  </Button>
                                  {saveStatus === "success" && (
                                    <span className="text-xs text-green-600">Saved</span>
                                  )}
                                  {saveStatus === "error" && saveError && (
                                    <span className="text-xs text-destructive">{saveError}</span>
                                  )}
                                </div>
                              </div>

                              <div className="space-y-2">
                                <p className="text-xs font-semibold">Allow tags</p>
                                <div className="flex flex-wrap gap-2">
                                  {entry.policy.allowTags?.length ? (
                                    entry.policy.allowTags.map((tag) => (
                                      <span
                                        key={`${agentId}-allow-tag-${tag}`}
                                        className="rounded border px-2 py-0.5 text-xs"
                                      >
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
                        );
                      })}
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
