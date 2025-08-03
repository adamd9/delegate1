"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ChecklistAndConfig from "@/components/checklist-and-config";

interface SetupStatusIndicatorProps {
  allChecksPassed: boolean;
  ready: boolean;
  setReady: (val: boolean) => void;
  selectedPhoneNumber: string;
  setSelectedPhoneNumber: (val: string) => void;
  checklistItems: { id: string; label: string; done: boolean }[];
}

export default function SetupStatusIndicator({
  allChecksPassed,
  ready,
  setReady,
  selectedPhoneNumber,
  setSelectedPhoneNumber,
  checklistItems,
}: SetupStatusIndicatorProps) {
  const [showChecklist, setShowChecklist] = useState(false);

  // Count incomplete items
  const incompleteCount = checklistItems.filter(item => !item.done).length;
  
  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={`flex items-center gap-1 ${!allChecksPassed ? "text-amber-500" : "text-green-500"}`}
              onClick={() => setShowChecklist(true)}
            >
              {allChecksPassed ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <span>Setup {allChecksPassed ? "Complete" : `(${incompleteCount})`}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div className="p-2">
              <p className="font-medium mb-1">Setup Status:</p>
              <ul className="space-y-1">
                {checklistItems.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 text-sm">
                    {item.done ? (
                      <CheckCircle className="h-3 w-3 text-green-500" />
                    ) : (
                      <AlertCircle className="h-3 w-3 text-amber-500" />
                    )}
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs mt-2">Click to open setup checklist</p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Checklist modal */}
      <ChecklistAndConfig
        ready={ready}
        setReady={setReady}
        selectedPhoneNumber={selectedPhoneNumber}
        setSelectedPhoneNumber={setSelectedPhoneNumber}
        open={showChecklist}
        onOpenChange={setShowChecklist}
      />
    </>
  );
}
