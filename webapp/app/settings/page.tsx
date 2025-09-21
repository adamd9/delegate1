"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Check, Edit, Plus, Trash, AlertCircle, Settings, Wrench, Phone, Info, BookOpen, Server, ChevronsLeft } from "lucide-react";
import { ToolConfigurationDialog } from "@/components/tool-configuration-dialog";
import { toolTemplates } from "@/lib/tool-templates";
import { useBackendTools } from "@/lib/use-backend-tools";
import { getBackendUrl } from "@/lib/get-backend-url";

// Simple vertical nav structure
const SECTIONS = [
  { id: "general", label: "General", icon: Settings },
  { id: "tools", label: "Tools", icon: Wrench },
  { id: "voice", label: "Voice & Telephony", icon: Phone },
  { id: "logs", label: "Logs", icon: BookOpen },
  { id: "adaptations", label: "Adaptations", icon: BookOpen },
  { id: "mcp", label: "MCP Servers", icon: Server },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
  { id: "about", label: "About", icon: Info },
] as const;

export default function SettingsPage() {
  const [active, setActive] = useState<string>("general");

  // Sync with URL query (?tab=tools)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab && SECTIONS.some(s => s.id === tab)) setActive(tab);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("tab", active);
    const url = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", url);
  }, [active]);

  // Shared state (adapted from session-configuration-panel)
  const [instructions, setInstructions] = useState("You are a helpful assistant in a phone call.");
  const [voice, setVoice] = useState("ballad");
  const [tools, setTools] = useState<string[]>([]);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingSchemaStr, setEditingSchemaStr] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [isJsonValid, setIsJsonValid] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [resetStatus, setResetStatus] = useState<"idle" | "resetting" | "done" | "error">("idle");
  const [buildInfo, setBuildInfo] = useState<{ commitId: string; commitMessage: string } | null>(null);

  // Fetch backend tools
  const backendTools = useBackendTools(`${getBackendUrl()}/tools`, 0);

  useEffect(() => {
    fetch("/build-info.json")
      .then((res) => res.json())
      .then(setBuildInfo)
      .catch(() => {/* ignore */});
  }, []);

  useEffect(() => {
    setHasUnsavedChanges(true);
  }, [instructions, voice, tools]);

  useEffect(() => {
    if (saveStatus === "saved") {
      const t = setTimeout(() => setSaveStatus("idle"), 2500);
      return () => clearTimeout(t);
    }
  }, [saveStatus]);

  // Save handler (local success marker; wire to backend if applicable)
  const handleSave = async () => {
    try {
      setSaveStatus("saving");
      // TODO: Wire to backend if/when an endpoint exists. For now, mark as saved.
      // Example (if implemented): await fetch(`${getBackendUrl()}/session/config`, { method: 'POST', body: JSON.stringify({...}) })
      await new Promise((r) => setTimeout(r, 250));
      setSaveStatus("saved");
      setHasUnsavedChanges(false);
    } catch (e) {
      setSaveStatus("error");
    }
  };

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

  // Tools helpers
  const getToolNameFromSchema = (schema: string): string => {
    try {
      const parsed = JSON.parse(schema);
      return parsed?.name || "Untitled Tool";
    } catch {
      return "Invalid JSON";
    }
  };

  const isBackendTool = (name: string): boolean => {
    return backendTools.some((t: any) => t.name === name);
  };

  const handleAddTool = () => {
    setEditingIndex(null);
    setEditingSchemaStr("");
    setSelectedTemplate("");
    setIsJsonValid(true);
    setOpenDialog(true);
  };

  const handleEditTool = (index: number) => {
    setEditingIndex(index);
    setEditingSchemaStr(tools[index] || "");
    setSelectedTemplate("");
    setIsJsonValid(true);
    setOpenDialog(true);
  };

  const handleDeleteTool = (index: number) => {
    const next = [...tools];
    next.splice(index, 1);
    setTools(next);
  };

  const handleDialogSave = () => {
    try {
      JSON.parse(editingSchemaStr);
    } catch {
      return;
    }
    const next = [...tools];
    if (editingIndex === null) next.push(editingSchemaStr);
    else next[editingIndex] = editingSchemaStr;
    setTools(next);
    setOpenDialog(false);
  };

  const onTemplateChange = (val: string) => {
    setSelectedTemplate(val);
    const templateObj =
      toolTemplates.find((t) => t.name === val) ||
      backendTools.find((t: any) => t.name === val);
    if (templateObj) {
      setEditingSchemaStr(JSON.stringify(templateObj, null, 2));
      setIsJsonValid(true);
    }
  };

  const onSchemaChange = (value: string) => {
    setEditingSchemaStr(value);
    try {
      JSON.parse(value);
      setIsJsonValid(true);
    } catch {
      setIsJsonValid(false);
    }
  };

  const voices = useMemo(() => ["ash", "ballad", "coral", "sage", "verse"], []);

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
          {active === "general" && (
            <Card className="w-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">General</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Instructions</label>
                  <Textarea
                    placeholder="Enter instructions"
                    className="min-h-[100px] resize-none"
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Voice</label>
                  <Select value={voice} onValueChange={setVoice}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select voice" />
                    </SelectTrigger>
                    <SelectContent>
                      {voices.map((v) => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
              <CardFooter className="flex items-center justify-between text-xs text-muted-foreground">
                <div>
                  {saveStatus === "error" ? (
                    <span className="text-red-500 inline-flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Save failed</span>
                  ) : hasUnsavedChanges ? (
                    <span>Not saved</span>
                  ) : (
                    <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" /> Saved</span>
                  )}
                </div>
                <Button onClick={handleSave} disabled={saveStatus === "saving" || !hasUnsavedChanges}>
                  {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : "Save Configuration"}
                </Button>
              </CardFooter>
            </Card>
          )}

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

          {active === "tools" && (
            <Card className="w-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Tools</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {tools.map((tool, index) => {
                  const name = getToolNameFromSchema(tool);
                  const backend = isBackendTool(name);
                  return (
                    <div key={index} className="flex items-center justify-between rounded-md border p-2 sm:p-3 gap-2">
                      <span className="text-sm truncate flex-1 min-w-0 flex items-center">
                        {name}
                        {backend && <span className="ml-2 text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground">Backend</span>}
                      </span>
                      <div className="flex gap-1 flex-shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditTool(index)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDeleteTool(index)}>
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
                <Button variant="outline" className="w-full" onClick={handleAddTool}>
                  <Plus className="h-4 w-4 mr-2" /> Add Tool
                </Button>
              </CardContent>
            </Card>
          )}

          {active === "voice" && (
            <Card className="w-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Voice & Telephony</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Manage voice setup and verify readiness.
                </p>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="text-sm">
                    <div className="font-medium">Voice Client</div>
                    <div className="text-muted-foreground">Open the embedded voice client to test calls.</div>
                  </div>
                  <Button asChild variant="outline"><Link href="/voice" target="_blank" rel="noopener noreferrer">Open Voice</Link></Button>
                </div>
                {/* Placeholder for a future detailed checklist integration */}
              </CardContent>
            </Card>
          )}

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
              <CardFooter />
            </Card>
          )}
        </ScrollArea>
      </main>

      {/* Tool dialog lives at page level to avoid unmount issues */}
      <ToolConfigurationDialog
        open={openDialog}
        onOpenChange={setOpenDialog}
        editingIndex={editingIndex}
        selectedTemplate={selectedTemplate}
        editingSchemaStr={editingSchemaStr}
        isJsonValid={isJsonValid}
        onTemplateChange={onTemplateChange}
        onSchemaChange={onSchemaChange}
        onSave={handleDialogSave}
        backendTools={backendTools}
      />
    </div>
  );
}
