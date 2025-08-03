"use client";

import { useState, useEffect, useMemo } from "react";
import { PhoneNumber } from "@/components/types";
import { getBackendUrl } from "@/lib/get-backend-url";

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
  backendUp: boolean;
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
  const [backendUp, setBackendUp] = useState(false);
  const [publicUrlAccessible, setPublicUrlAccessible] = useState(false);

  const [allChecksPassed, setAllChecksPassed] = useState(false);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [ngrokLoading, setNgrokLoading] = useState(false);
  
  const appendedTwimlUrl = publicUrl ? `${publicUrl}/twiml` : "";
  const isWebhookMismatch = Boolean(
    appendedTwimlUrl && currentVoiceUrl && appendedTwimlUrl !== currentVoiceUrl
  );
    
  // Single function to check public URL accessibility
  // This is used both by the polling logic and by direct UI calls
  const checkPublicUrlAccessibility = async (urlToCheck?: string, setLoading = true) => {
    // Use provided URL or fall back to state
    const url = urlToCheck || publicUrl;
    
    if (!url) {
      console.error("No URL provided for accessibility check");
      setPublicUrlAccessible(false);
      if (setLoading) setNgrokLoading(false);
      return false;
    }
    
    if (setLoading) setNgrokLoading(true);
    
    try {
      const resTest = await fetch(url + "/public-url");
      if (resTest.ok) {
        console.log("Public URL accessible:", resTest);
        setPublicUrlAccessible(true);
        console.log("Public URL accessible:", publicUrlAccessible);
        if (setLoading) setNgrokLoading(false);
        return true;
      } else {
        console.error("Public URL not accessible:", resTest);
        setPublicUrlAccessible(false);
        if (setLoading) setNgrokLoading(false);
        return false;
      }
    } catch (error) {
      console.error("Error checking public URL accessibility:", error);
      setPublicUrlAccessible(false);
      if (setLoading) setNgrokLoading(false);
      return false;
    }
  };

  // Polling for setup checks
  useEffect(() => {
    let polling = true;
    let attempts = 0;
    const MAX_ATTEMPTS = 20; // 20 seconds max
    let hasShownError = false;

    // Function to check if all setup is complete
    const isSetupComplete = () => {
      console.log("Checking setup complete:", {
        hasCredentials,
        backendUp,
        publicUrl,
        publicUrlAccessible,
      });
      return hasCredentials && 
             backendUp && 
             publicUrl && 
             publicUrlAccessible;
      // Note: phoneNumbers and currentNumberSid are optional
    };

    const pollChecks = async () => {
      // Stop polling if all checks have passed
      if (isSetupComplete()) {
        console.log("All setup checks passed, stopping polling");
        polling = false;
        return;
      }
      // Check if we've reached max attempts
      if (attempts >= MAX_ATTEMPTS) {
        if (!hasShownError) {
          alert("Setup checks failed after 20 seconds. Please refresh the page to try again.");
          hasShownError = true;
        }
        // Stop the polling completely
        polling = false;
        return;
      }
      
      attempts++;
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

        // 3. Check server & public URL
        let foundPublicUrl = "";
        let previousUrl = publicUrl;
        try {
          // Use the centralized getBackendUrl utility
          const serverUrl = getBackendUrl();
          const res = await fetch(`${serverUrl}/public-url`);
          
          if (res.ok) {
            const pubData = await res.json();
            foundPublicUrl = pubData?.publicUrl || "";
            setBackendUp(true);
            setPublicUrl(foundPublicUrl);
            
            // Check public URL accessibility using our consolidated function
            if (foundPublicUrl) {
              console.log("[DEBUG] Calling checkPublicUrlAccessibility from polling with URL:", foundPublicUrl);
              const result = await checkPublicUrlAccessibility(foundPublicUrl, false);
              
              // If accessibility check passed, manually check if setup is complete with the updated state
              if (result) {
                // Use the latest state values directly
                const setupComplete = hasCredentials && 
                                     backendUp && 
                                     foundPublicUrl && 
                                     true; // publicUrlAccessible is true since result is true
                
                console.log("[DEBUG] Manual setup complete check:", setupComplete);
                
                if (setupComplete) {
                  console.log("[DEBUG] Setup is complete, stopping polling");
                  polling = false;
                  setAllChecksPassed(true);
                }
              }
            }
          } else {
            throw new Error("Local server not responding");
          }
        } catch {
          console.error("Local server not responding");
          setBackendUp(false);
          setPublicUrl("");
          setPublicUrlAccessible(false); // Reset ngrok status when server is down
        }
      } catch (err) {
        console.error(err);
      }
    };

    pollChecks();
    const intervalId = setInterval(() => {
      if (polling) {
        pollChecks();
      } else {
        clearInterval(intervalId);
      }
    }, 1000);
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
        done: backendUp,
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
    backendUp,
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
      backendUp,
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
      // Wrap our function to match the expected type signature
      checkNgrok: async () => { await checkPublicUrlAccessibility(); },
      setCurrentNumberSid: handlePhoneNumberSelection,
      setSelectedPhoneNumber,
    },
  ];
}
