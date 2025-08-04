"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Circle, CheckCircle, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import StatusSingletonChecker from "@/lib/statusSingletonChecker";

export default function ChecklistAndConfig({
  ready,
  setReady,
  open = !ready,
  onOpenChange,
}: {
  ready: boolean;
  setReady: (val: boolean) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  // Use singleton checker for checklist logic
  const [checklistResult, setChecklistResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Run checklist on mount
  useEffect(() => {
    setLoading(true);
    StatusSingletonChecker.runChecklist().then((result) => {
      setChecklistResult(result);
      setLoading(false);
      setReady(result.status === 'success');
    });
  }, [setReady]);

  const refreshChecklist = () => {
    setLoading(true);
    StatusSingletonChecker.runChecklist().then((result) => {
      setChecklistResult(result);
      setLoading(false);
      setReady(result.status === 'success');
    });
  };

  const handleDone = () => setReady(true);

  // Build UI fields for each checklist item
  const checklistWithFields = (checklistResult?.details?.checks || []).map((item: { id: string; label: string; passed: boolean; info: string }, i: number) => {
    let field = null;
    
    // Add appropriate UI field for each checklist item
    switch (item.id) {
      case "twilio-account":
        field = (
          <Button
            className="w-full"
            onClick={() => window.open("https://console.twilio.com/", "_blank")}
          >
            Open Twilio Console
          </Button>
        );
        break;
      case "twilio-phone":
        field = (
          <Input value={item.info || ""} disabled />
        );
        break;
      case "ngrok":
        field = (
          <div className="flex items-center gap-2 w-full">
            <div className="flex-1">
              <Input value={item.info || ""} disabled />
            </div>
            <Button
              variant="outline"
              onClick={refreshChecklist}
              disabled={loading}
            >
              {loading ? <Loader2 className="animate-spin" size={16} /> : "Retry"}
            </Button>
          </div>
        );
        break;
      case "webhook":
        field = (
          <div className="flex items-center gap-2 w-full">
            <div className="flex-1">
              <Input value={checklistResult.currentVoiceUrl} disabled className="w-full" />
            </div>
            <div className="flex-1">
              <Button
                onClick={checklistResult.updateWebhook}
                disabled={checklistResult.webhookLoading}
                className="w-full"
              >
                {checklistResult.webhookLoading ? (
                  <Loader2 className="mr-2 h-4 animate-spin" />
                ) : (
                  "Update Webhook"
                )}
              </Button>
            </div>
          </div>
        );
        break;
    }

    return {
      ...item,
      field
    };
  });

  // Handle dialog open checklistResult
  const dialogOpen = typeof onOpenChange === 'function' ? open : !ready;
  const handleOpenChange = (newOpen: boolean) => {
    if (typeof onOpenChange === 'function') {
      onOpenChange(newOpen);
    } else if (newOpen === false) {
      // Only allow closing if all checks passed or we're forcing it
      if (checklistResult.allChecksPassed) {
        setReady(true);
      }
    }
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="w-full max-w-[800px]">
        <DialogHeader>
          <DialogTitle>Setup Checklist</DialogTitle>
          <DialogDescription>
            Delegate 1 supports multiple ways to interact with your AI assistant:
            <br />• <strong>Voice Client</strong>: Browser-based voice calls (works immediately)
            <br />• <strong>Traditional Phone</strong>: Call a real phone number (requires Twilio phone number)
            <br />• <strong>Web Chat</strong>: Text-based conversations (works immediately)
            <br /><br />
            Complete the required steps below to get started. Phone number setup is optional.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-0">
          {checklistWithFields.map((item, i) => (
            <div
              key={i}
              className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 py-2"
            >
              <div className="flex flex-col">
                <div className="flex items-center gap-2 mb-1">
                  {item.done ? (
                    <CheckCircle className="text-green-500" />
                  ) : (
                    <Circle className="text-gray-400" />
                  )}
                  <span className="font-medium">{item.label}</span>
                </div>
                {item.description && (
                  <p className="text-sm text-gray-500 ml-8">
                    {item.description}
                  </p>
                )}
              </div>
              <div className="flex items-center mt-2 sm:mt-0">{item.field}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-col sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={handleDone}
            disabled={!checklistResult?.allChecksPassed}
          >
            Let's go!
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
