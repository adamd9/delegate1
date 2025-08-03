// PhoneNumberChecklist.tsx
"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { AlertCircle, CheckCircle, Circle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import ChecklistAndConfig from "@/components/checklist-and-config";
import { useSetupChecklist } from "@/lib/hooks/useSetupChecklist";

type PhoneNumberChecklistProps = {
  selectedPhoneNumber: string;
  allConfigsReady: boolean;
  setAllConfigsReady: (ready: boolean) => void;
  setSelectedPhoneNumber: (phoneNumber: string) => void;
};

const PhoneNumberChecklist: React.FC<PhoneNumberChecklistProps> = ({
  selectedPhoneNumber,
  allConfigsReady,
  setAllConfigsReady,
  setSelectedPhoneNumber,
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [showChecklist, setShowChecklist] = useState(false);
  
  // Use the setup checklist hook
  const [setupState, setupActions] = useSetupChecklist(
    selectedPhoneNumber,
    setSelectedPhoneNumber
  );
  
  // Count incomplete items
  const incompleteCount = setupState.checklist.filter(item => !item.done).length;

  return (
    <>
      {/* Phone number card */}
      {renderCard()}
      
      {/* Checklist modal */}
      <ChecklistAndConfig
        ready={allConfigsReady}
        setReady={setAllConfigsReady}
        selectedPhoneNumber={selectedPhoneNumber}
        setSelectedPhoneNumber={setSelectedPhoneNumber}
        open={showChecklist}
        onOpenChange={setShowChecklist}
      />
    </>
  );

  function renderCard() {
    return (
      <Card className="flex items-center justify-between p-4">
        <div className="flex flex-col">
          <span className="text-sm text-gray-500">Number</span>
          <div className="flex items-center">
            <span className="font-medium w-36">
              {isVisible ? selectedPhoneNumber || "None" : "••••••••••"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsVisible(!isVisible)}
              className="h-8 w-8"
            >
              {isVisible ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => setShowChecklist(true)}>
                  {setupState.allChecksPassed ? (
                    <CheckCircle className="text-green-500 w-4 h-4" />
                  ) : (
                    <AlertCircle className="text-amber-500 w-4 h-4" />
                  )}
                  <span className="text-sm text-gray-700">
                    {setupState.allChecksPassed ? "Setup Ready" : `Setup (${incompleteCount})`}
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div className="p-2">
                  <p className="font-medium mb-1">Setup Status:</p>
                  <ul className="space-y-1">
                    {setupState.checklist.map((item) => (
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
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowChecklist(true)}
            className={!setupState.allChecksPassed ? "border-amber-500 text-amber-700" : ""}
          >
            Checklist
          </Button>
        </div>
      </Card>
    );
  }
};

export default PhoneNumberChecklist;
