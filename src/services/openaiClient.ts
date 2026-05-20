import OpenAI, { ClientOptions } from "openai";
import { ProxyAgent } from "undici";
import { configService } from "../config";

export function createOpenAIClient(): OpenAI {
  if (!configService.get("OPENAI_API_KEY")) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }
  const options: ClientOptions = { apiKey: configService.get("OPENAI_API_KEY") };
  if (configService.get("CODEX_CLI") === "true" && configService.get("HTTPS_PROXY")) {
    try {
      const dispatcher = new ProxyAgent(configService.get("HTTPS_PROXY")!);
      options.fetch = (url, init: any = {}) => {
        return (globalThis.fetch as any)(url, { ...(init || {}), dispatcher });
      };
      console.debug("OpenAI Client", "Using undici ProxyAgent for Codex environment");
    } catch (e) {
      console.warn("OpenAI Client", "Failed to configure ProxyAgent, continuing without proxy:", e);
    }
  }
  return new OpenAI(options);
}
