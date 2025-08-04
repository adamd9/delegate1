// statusSingletonChecker.ts
// Singleton checklist runner for setup, runs only once per app session
import { getBackendUrl } from "./get-backend-url";

export type ChecklistStatus = 'not_started' | 'running' | 'success' | 'timeout' | 'error';

interface ChecklistResult {
  status: ChecklistStatus;
  details?: any;
}

class StatusSingletonChecker {
  private status: ChecklistStatus = 'not_started';
  private result: ChecklistResult | null = null;
  private promise: Promise<ChecklistResult> | null = null;

  public getStatus(): ChecklistStatus {
    return this.status;
  }

  public async runChecklist(): Promise<ChecklistResult> {
    if (this.promise) return this.promise;
    this.status = 'running';
    console.log('[statusSingletonChecker] Checklist started');
    this.promise = new Promise(async (resolve) => {
      try {
        const timeoutMs = 20000;
        let completed = false;
        const timer = setTimeout(() => {
          if (!completed) {
            this.status = 'timeout';
            this.result = { status: 'timeout' };
            console.log('[statusSingletonChecker] Checklist timed out');
            resolve(this.result);
          }
        }, timeoutMs);

        // Run the real checklist logic
        const result = await this.runRealChecklist();
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          this.status = result.passed ? 'success' : 'error';
          this.result = { status: this.status, details: { checks: result.checks } };
          console.log('[statusSingletonChecker] Checklist result:', this.status, this.result.details);
          resolve(this.result);
        }
      } catch (err) {
        this.status = 'error';
        this.result = { status: 'error', details: err };
        console.error('[statusSingletonChecker] Checklist error:', err);
        resolve(this.result!);
      }
    });
    return this.promise;
  }

  // Real checklist logic based on webapp setup
  private async runRealChecklist(): Promise<{ passed: boolean, checks: any[] }> {
    const checks: any[] = [];
    let passed = true;
    // 1. Check Twilio credentials
    let credRes, credData;
    try {
      credRes = await fetch("/api/twilio");
      credData = credRes.ok ? await credRes.json() : {};
      const hasCredentials = !!credData?.credentialsSet;
      checks.push({
        id: "twilio-account",
        label: "Set up Twilio account",
        passed: hasCredentials,
        info: hasCredentials ? "Credentials set" : "Credentials missing"
      });
      if (!hasCredentials) passed = false;
    } catch (e) {
      checks.push({ id: "twilio-account", label: "Set up Twilio account", passed: false, info: "Error: " + e });
      passed = false;
    }
    // 2. Check Twilio phone numbers
    let numbersRes, numbersData;
    try {
      numbersRes = await fetch("/api/twilio/numbers");
      numbersData = numbersRes.ok ? await numbersRes.json() : [];
      const hasPhone = Array.isArray(numbersData) && numbersData.length > 0;
      checks.push({
        id: "twilio-phone",
        label: "Set up Twilio phone number (Optional)",
        passed: hasPhone,
        info: hasPhone ? `Found ${numbersData.length} phone number(s)` : "No phone numbers configured"
      });
      // Not required for overall pass
    } catch (e) {
      checks.push({ id: "twilio-phone", label: "Set up Twilio phone number (Optional)", passed: false, info: "Error: " + e });
    }
    // 3. Check backend server (public-url)
    let backendUp = false, publicUrl = "";
    try {
      const pubRes = await fetch(getBackendUrl() + "/public-url");
      if (pubRes.ok) {
        const pubData = await pubRes.json();
        publicUrl = pubData?.publicUrl || "";
        backendUp = !!publicUrl;
      }
      checks.push({
        id: "websocket-server",
        label: "Start local WebSocket server",
        passed: backendUp,
        info: backendUp ? `Public URL: ${publicUrl}` : "No public URL returned"
      });
      if (!backendUp) passed = false;
    } catch (e) {
      checks.push({ id: "websocket-server", label: "Start local WebSocket server", passed: false, info: "Error: " + e });
      passed = false;
    }
    // 4. Check ngrok/public URL accessibility
    let ngrokAccessible = false;
    if (publicUrl) {
      try {
        const testRes = await fetch(publicUrl + "/public-url");
        ngrokAccessible = testRes.ok;
        checks.push({
          id: "ngrok",
          label: "Start ngrok",
          passed: ngrokAccessible,
          info: ngrokAccessible ? "Ngrok/public URL accessible" : "Ngrok/public URL not accessible"
        });
        if (!ngrokAccessible) passed = false;
      } catch (e) {
        checks.push({ id: "ngrok", label: "Start ngrok", passed: false, info: "Error: " + e });
        passed = false;
      }
    } else {
      checks.push({ id: "ngrok", label: "Start ngrok", passed: false, info: "No public URL to check" });
      passed = false;
    }
    // 5. Check Twilio webhook URL (voiceUrl matches publicUrl/twiml)
    if (numbersData && numbersData.length > 0 && publicUrl) {
      const appendedTwimlUrl = publicUrl ? `${publicUrl}/twiml` : "";
const onlyNumber = numbersData[0];
const isWebhookMismatch = Boolean(appendedTwimlUrl && onlyNumber?.voiceUrl && appendedTwimlUrl !== onlyNumber.voiceUrl);
checks.push({
  id: "webhook",
  label: "Update Twilio webhook URL",
  passed: !!publicUrl && !isWebhookMismatch,
  info: !isWebhookMismatch ? "Webhook URL matches" : `Expected: ${appendedTwimlUrl}, Found: ${onlyNumber?.voiceUrl}`
});
if (isWebhookMismatch) passed = false;
    } else {
      checks.push({ id: "webhook", label: "Update Twilio webhook URL", passed: false, info: "No phone number or public URL" });
      passed = false;
    }
    return { passed, checks };
  }

  // Replace this with real checklist logic
  private async simulateChecklist(): Promise<boolean> {
    const result = await this.runRealChecklist();
    this._latestChecks = result.checks;
    return result.passed;
  }
  private _latestChecks: any[] = [];

}

const singleton = new StatusSingletonChecker();
export default singleton;
