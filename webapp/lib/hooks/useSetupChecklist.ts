"use client";

import { useState, useEffect, useMemo } from "react";
import { PhoneNumber } from "@/components/types";

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  description: string;
}

export interface SetupChecklistState {
  hasCredentials: boolean;
  phoneNumbers: PhoneNumber[];
  currentNumberSid: string;
  currentVoiceUrl: string;
  publicUrl: string;
  localServerUp: boolean;
  publicUrlAccessible: boolean;
  allChecksPassed: boolean;
  webhookLoading: boolean;
  ngrokLoading: boolean;
  isWebhookMismatch: boolean;
  appendedTwimlUrl: string;
  checklist: ChecklistItem[];
}

export interface SetupChecklistActions {
  updateWebhook: () => Promise<void>;
  checkNgrok: () => Promise<void>;
  setCurrentNumberSid: (sid: string) => void;
  setSelectedPhoneNumber: (phoneNumber: string) => void;
}

export function useSetupChecklist(
  selectedPhoneNumber: string,
  setSelectedPhoneNumber: (val: string) => void
): [SetupChecklistState, SetupChecklistActions] {
  // State variables from the original component
  const [hasCredentials, setHasCredentials] = useState(false);
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [currentNumberSid, setCurrentNumberSid] = useState("");
  const [currentVoiceUrl, setCurrentVoiceUrl] = useState("");

  const [publicUrl, setPublicUrl] = useState("");
  const [localServerUp, setLocalServerUp] = useState(false);
  const [publicUrlAccessible, setPublicUrlAccessible] = useState(false);

  const [allChecksPassed, setAllChecksPassed] = useState(false);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [ngrokLoading, setNgrokLoading] = useState(false);
  
  // Flag to trigger ngrok check
  const [shouldCheckNgrok, setShouldCheckNgrok] = useState(false);

  const appendedTwimlUrl = publicUrl ? `${publicUrl}/twiml` : "";
  const isWebhookMismatch = Boolean(
    appendedTwimlUrl && currentVoiceUrl && appendedTwimlUrl !== currentVoiceUrl
  );
    
  // Check ngrok function
  const checkNgrok = async () => {
    if (!localServerUp || !publicUrl) {
      setPublicUrlAccessible(false);
      setNgrokLoading(false);
      return;
    }
    
    setNgrokLoading(true);
    let success = false;
    
    for (let i = 0; i < 5; i++) {
      try {
        const resTest = await fetch(publicUrl + "/public-url");
        if (resTest.ok) {
          // Just check for a successful response, don't try to parse content
          setPublicUrlAccessible(true);
          success = true;
          break;
        }
      } catch (error) {
        console.error("Error checking ngrok:", error);
        // retry
      }
      
      if (i < 4) {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    
    if (!success) {
      setPublicUrlAccessible(false);
    }
    
    setNgrokLoading(false);
  };

  // Effect to run ngrok check when triggered
  useEffect(() => {
    if (shouldCheckNgrok) {
      checkNgrok();
      setShouldCheckNgrok(false);
    }
  }, [shouldCheckNgrok, publicUrl, localServerUp]);

  // Polling for setup checks
  useEffect(() => {
    let polling = true;

    const pollChecks = async () => {
      try {
        // 1. Check credentials
        let res = await fetch("/api/twilio");
        if (!res.ok) throw new Error("Failed credentials check");
        const credData = await res.json();
        setHasCredentials(!!credData?.credentialsSet);

        // 2. Fetch numbers
        res = await fetch("/api/twilio/numbers");
        if (!res.ok) throw new Error("Failed to fetch phone numbers");
        const numbersData = await res.json();
        if (Array.isArray(numbersData) && numbersData.length > 0) {
          setPhoneNumbers(numbersData);
          // If currentNumberSid not set or not in the list, use first
          const selected =
            numbersData.find((p: PhoneNumber) => p.sid === currentNumberSid) ||
            numbersData[0];
          setCurrentNumberSid(selected.sid);
          setCurrentVoiceUrl(selected.voiceUrl || "");
          setSelectedPhoneNumber(selected.friendlyName || "");
        }

        // 3. Check local server & public URL
        let foundPublicUrl = "";
        let previousUrl = publicUrl;
        try {
          const resLocal = await fetch("http://localhost:8081/public-url");
          if (resLocal.ok) {
            const pubData = await resLocal.json();
            foundPublicUrl = pubData?.publicUrl || "";
            setLocalServerUp(true);
            setPublicUrl(foundPublicUrl);
            
            // If public URL changed, trigger ngrok check
            if (foundPublicUrl && foundPublicUrl !== previousUrl) {
              setShouldCheckNgrok(true);
            }
          } else {
            throw new Error("Local server not responding");
          }
        } catch {
          setLocalServerUp(false);
          setPublicUrl("");
          setPublicUrlAccessible(false); // Reset ngrok status when server is down
        }
      } catch (err) {
        console.error(err);
      }
    };

    pollChecks();
    const intervalId = setInterval(() => polling && pollChecks(), 1000);
    return () => {
      polling = false;
      clearInterval(intervalId);
    };
  }, [currentNumberSid, setSelectedPhoneNumber, publicUrl]);

  // Update webhook function
  const updateWebhook = async () => {
    if (!currentNumberSid || !appendedTwimlUrl) return;
    try {
      setWebhookLoading(true);
      const res = await fetch("/api/twilio/numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumberSid: currentNumberSid,
          voiceUrl: appendedTwimlUrl,
        }),
      });
      if (!res.ok) throw new Error("Failed to update webhook");
      setCurrentVoiceUrl(appendedTwimlUrl);
    } catch (err) {
      console.error(err);
    } finally {
      setWebhookLoading(false);
    }
  };

  // Define checklist items
  const checklist = useMemo(() => {
    return [
      {
        id: "twilio-account",
        label: "Set up Twilio account",
        done: hasCredentials,
        description: "Then update account details in webapp/.env",
      },
      {
        id: "twilio-phone",
        label: "Set up Twilio phone number (Optional)",
        done: phoneNumbers.length > 0 || true, // Always considered "done" since it's optional
        description: phoneNumbers.length > 0 ? "Phone number configured" : "Optional - for traditional phone calls. Voice client works without this.",
      },
      {
        id: "websocket-server",
        label: "Start local WebSocket server",
        done: localServerUp,
        description: "cd websocket-server && npm run dev",
      },
      {
        id: "ngrok",
        label: "Start ngrok",
        done: publicUrlAccessible,
        description: "Then set ngrok URL in websocket-server/.env",
      },
      {
        id: "webhook",
        label: "Update Twilio webhook URL",
        done: !!publicUrl && !isWebhookMismatch,
        description: "Can also be done manually in Twilio console",
      },
    ];
  }, [
    hasCredentials,
    phoneNumbers,
    localServerUp,
    publicUrl,
    publicUrlAccessible,
    isWebhookMismatch,
  ]);

  // Update allChecksPassed when checklist changes
  useEffect(() => {
    setAllChecksPassed(checklist.every((item) => item.done));
  }, [checklist]);

  // Handle phone number selection
  const handlePhoneNumberSelection = (sid: string) => {
    setCurrentNumberSid(sid);
    const selected = phoneNumbers.find((p) => p.sid === sid);
    if (selected) {
      setSelectedPhoneNumber(selected.friendlyName || "");
      setCurrentVoiceUrl(selected.voiceUrl || "");
    }
  };

  // Return state and actions
  return [
    {
      hasCredentials,
      phoneNumbers,
      currentNumberSid,
      currentVoiceUrl,
      publicUrl,
      localServerUp,
      publicUrlAccessible,
      allChecksPassed,
      webhookLoading,
      ngrokLoading,
      isWebhookMismatch,
      appendedTwimlUrl,
      checklist,
    },
    {
      updateWebhook,
      checkNgrok,
      setCurrentNumberSid: handlePhoneNumberSelection,
      setSelectedPhoneNumber,
    },
  ];
}
