"use client";

import React, { useState, useEffect } from "react";
import StatusSingletonChecker from "@/lib/statusSingletonChecker";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


interface SetupStatusIndicatorProps {
  ready: boolean;
  setReady: (val: boolean) => void;
  selectedPhoneNumber: string;
  setSelectedPhoneNumber: (val: string) => void;
}

export default function SetupStatusIndicator({
  ready,
  setReady,
  selectedPhoneNumber,
  setSelectedPhoneNumber,
}: SetupStatusIndicatorProps) {
  const [showChecklist, setShowChecklist] = useState(false);
  const [checklistResult, setChecklistResult] = useState<any>(null);

  // Subscribe to singleton updates for live checklist state
  useEffect(() => {
    let mounted = true;
    StatusSingletonChecker.runChecklist().then((result) => {
      if (!mounted) return;
      setChecklistResult(result);
    });
    const updateHandler = (result: any) => {
      if (!mounted) return;
      setChecklistResult(result);
    };
    StatusSingletonChecker.onUpdate(updateHandler);
    return () => {
      mounted = false;
      StatusSingletonChecker.offUpdate(updateHandler);
    };
  }, []);

  // Derive checklistItems and allChecksPassed from singleton state
  const checklistItems: { id: string; label: string; done: boolean }[] = checklistResult?.details?.checks?.map((item: any) => ({
    id: item.id,
    label: item.label,
    done: item.passed || item.done // fallback for legacy fields
  })) || [];
  const allChecksPassed = checklistResult?.status === 'success';
  const incompleteCount = checklistItems.filter(item => !item.done).length;

  return (
    <Button
      variant="ghost"
      size="sm"
      className={`flex items-center gap-1 ${!allChecksPassed ? "text-amber-500" : "text-green-500"}`}
      disabled
    >
      {allChecksPassed ? (
        <CheckCircle className="h-4 w-4" />
      ) : (
        <AlertCircle className="h-4 w-4" />
      )}
      <span>Setup {allChecksPassed ? "Complete" : `(${incompleteCount})`}</span>
    </Button>
  );
}
