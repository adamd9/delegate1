// ServiceChecklist.tsx
"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { AlertCircle, CheckCircle, Circle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";




type ServiceChecklistProps = {
  checklistResult: any;
  allConfigsReady: boolean;
  setAllConfigsReady: (ready: boolean) => void;
};

const ServiceChecklist: React.FC<ServiceChecklistProps> = ({
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
      <Card className="flex items-center justify-between p-4 border-0 shadow-none">
        <div className="flex items-center gap-4">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-2">
                  {allChecksPassed ? (
                    <CheckCircle className="text-green-500 w-4 h-4" />
                  ) : (
                    <AlertCircle className="text-amber-500 w-4 h-4" />
                  )}
                  <span className="text-sm text-gray-700">
                    {allChecksPassed ? "Ready" : `Setup (${incompleteCount})`}
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

export default ServiceChecklist;
