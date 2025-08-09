import { WebSocket } from "ws";

export interface Session {
  twilioConn?: WebSocket;
  frontendConn?: WebSocket;
  modelConn?: WebSocket;
  config?: any;
  streamSid?: string;
}

// Legacy Chat Completions API types
export interface FunctionCallItem {
  name: string;
  arguments: string;
  call_id?: string;
}

export interface FunctionSchema {
  name: string;
  type: "function";
  description?: string;
  parameters: {
    type: string;
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
}

export interface FunctionHandler {
  schema: FunctionSchema;
  handler: (args: any, addBreadcrumb?: (title: string, data?: any) => void) => Promise<any>;
}

// New Responses API types
// These types are based on OpenAI SDK v4.67.3

// For input to the Responses API
export interface ResponsesTextInput {
  type: "message";
  content: string;
  role: "user" | "assistant" | "system" | "developer";
}

export interface ResponsesFunctionCallOutput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export type ResponsesInputItem = ResponsesTextInput | ResponsesFunctionCallOutput;

// For output from the Responses API
export interface ResponsesFunctionCall {
  type: "function_call";
  name: string;
  call_id: string;
  arguments: string;
}

export interface ResponsesTextOutput {
  type: "message";
  text: string;
}

export type ResponsesOutputItem = ResponsesTextOutput | ResponsesFunctionCall;