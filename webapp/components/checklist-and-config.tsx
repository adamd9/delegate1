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
import { useSetupChecklist } from "@/lib/hooks/useSetupChecklist";

export default function ChecklistAndConfig({
  ready,
  setReady,
  selectedPhoneNumber,
  setSelectedPhoneNumber,
  open = !ready,
  onOpenChange,
}: {
  ready: boolean;
  setReady: (val: boolean) => void;
  selectedPhoneNumber: string;
  setSelectedPhoneNumber: (val: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  // Use our extracted hook for all the checklist logic
  const [state, actions] = useSetupChecklist(
    selectedPhoneNumber,
    setSelectedPhoneNumber
  );

  // Check ngrok when component loads if not ready
  useEffect(() => {
    if (!ready && state.localServerUp) {
      actions.checkNgrok();
    }
  }, [state.localServerUp, ready, actions]);

  // Update ready state based on checklist status
  useEffect(() => {
    if (!state.allChecksPassed) {
      setReady(false);
    }
  }, [state.allChecksPassed, setReady]);

  const handleDone = () => setReady(true);

  // Build UI fields for each checklist item
  const checklistWithFields = state.checklist.map(item => {
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
        if (state.phoneNumbers.length > 0) {
          field = state.phoneNumbers.length === 1 ? (
            <Input value={state.phoneNumbers[0].friendlyName || ""} disabled />
          ) : (
            <Select
              onValueChange={(value) => actions.setCurrentNumberSid(value)}
              value={state.currentNumberSid}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a phone number" />
              </SelectTrigger>
              <SelectContent>
                {state.phoneNumbers.map((phone) => (
                  <SelectItem key={phone.sid} value={phone.sid}>
                    {phone.friendlyName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        } else {
          field = (
            <Button
              className="w-full"
              variant="outline"
              onClick={() =>
                window.open(
                  "https://console.twilio.com/us1/develop/phone-numbers/manage/incoming",
                  "_blank"
                )
              }
            >
              Optional: Add Phone Number
            </Button>
          );
        }
        break;
      case "ngrok":
        field = (
          <div className="flex items-center gap-2 w-full">
            <div className="flex-1">
              <Input value={state.publicUrl} disabled />
            </div>
            <div className="flex-1">
              <Button
                variant="outline"
                onClick={actions.checkNgrok}
                disabled={state.ngrokLoading || !state.localServerUp || !state.publicUrl}
                className="w-full"
              >
                {state.ngrokLoading ? (
                  <Loader2 className="mr-2 h-4 animate-spin" />
                ) : (
                  "Check ngrok"
                )}
              </Button>
            </div>
          </div>
        );
        break;
      case "webhook":
        field = (
          <div className="flex items-center gap-2 w-full">
            <div className="flex-1">
              <Input value={state.currentVoiceUrl} disabled className="w-full" />
            </div>
            <div className="flex-1">
              <Button
                onClick={actions.updateWebhook}
                disabled={state.webhookLoading}
                className="w-full"
              >
                {state.webhookLoading ? (
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

  // Handle dialog open state
  const dialogOpen = typeof onOpenChange === 'function' ? open : !ready;
  const handleOpenChange = (newOpen: boolean) => {
    if (typeof onOpenChange === 'function') {
      onOpenChange(newOpen);
    } else if (newOpen === false) {
      // Only allow closing if all checks passed or we're forcing it
      if (state.allChecksPassed) {
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
            disabled={!state.allChecksPassed}
          >
            Let's go!
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
