// PhoneNumberChecklist.tsx
"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { AlertCircle, CheckCircle, Circle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";




type PhoneNumberChecklistProps = {
  checklistResult: any;
  allConfigsReady: boolean;
  setAllConfigsReady: (ready: boolean) => void;
};

const PhoneNumberChecklist: React.FC<PhoneNumberChecklistProps> = ({
  checklistResult,
  allConfigsReady,
  setAllConfigsReady,
}) => {
  type ChecklistItem = { id: string; label: string; passed: boolean; info: string; done?: boolean; description?: string };
const checklist: ChecklistItem[] = checklistResult?.details?.checks || [];
  const allChecksPassed = checklistResult?.status === 'success';
  const phoneNumber = checklistResult?.details?.phoneNumber || '';
  const [isVisible, setIsVisible] = useState(true);

  // Count incomplete items
  const incompleteCount = checklist.filter(item => !item.done && !item.passed).length;

  return (
    <>
      {/* Phone number card */}
      {renderCard()}
    </>
  );

  function renderCard() {
    return (
      <Card className="flex items-center justify-between p-4">
        <div className="flex flex-col">
          <span className="text-sm text-gray-500">Number</span>
          <div className="flex items-center">
            <span className="font-medium w-36">
              {isVisible ? phoneNumber || "None" : "••••••••••"}
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
                <div className="flex items-center gap-2 cursor-pointer">
                  {allChecksPassed ? (
                    <CheckCircle className="text-green-500 w-4 h-4" />
                  ) : (
                    <AlertCircle className="text-amber-500 w-4 h-4" />
                  )}
                  <span className="text-sm text-gray-700">
                    {allChecksPassed ? "Setup Ready" : `Setup (${incompleteCount})`}
                  </span>
                </div>
              </TooltipTrigger>
            </Tooltip>
          </TooltipProvider>
        </div>
      </Card>
    );
  }
};

export default PhoneNumberChecklist;
