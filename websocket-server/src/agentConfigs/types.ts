// Central re-exports and types for agent configurations

export interface FunctionHandler {
  schema: {
    name: string;
    type: "function";
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required: string[];
      additionalProperties?: boolean;
    };
  };
  handler: (args: any, addBreadcrumb?: (title: string, data?: any) => void) => Promise<any>;
}

export interface AgentConfig {
  name: string;
  instructions: string;
  voice?: string;
  tools: FunctionHandler[];
  // Deprecated: use textModel and voiceModel instead. Retained for backward compatibility.
  model?: string;
  // Model to use for text (Responses API) interactions
  textModel?: string;
  // Model to use for voice (Realtime API/websocket) interactions
  voiceModel?: string;
  temperature?: number;
}

// Removed AgentSet interface - not needed for single agent configuration
