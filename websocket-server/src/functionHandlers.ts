import { FunctionHandler } from "./types";
import OpenAI from 'openai';

const functions: FunctionHandler[] = [];

functions.push({
  schema: {
    name: "get_weather_from_coords",
    type: "function",
    description: "Get the current weather",
    parameters: {
      type: "object",
      properties: {
        latitude: {
          type: "number",
        },
        longitude: {
          type: "number",
        },
      },
      required: ["latitude", "longitude"],
    },
  },
  handler: async (args: { latitude: number; longitude: number }) => {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m`
    );
    const data = await response.json();
    const currentTemp = data.current?.temperature_2m;
    return JSON.stringify({ temp: currentTemp });
  },
});

// Supervisor Agent Tools - Available to supervisor for nested function calls
const supervisorTools = [
  {
    type: "function" as const,
    function: {
      name: "lookupKnowledgeBase",
      description: "Look up information from the knowledge base by topic or keyword.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "The topic or keyword to search for in the knowledge base."
          }
        },
        required: ["topic"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "analyzeComplexQuery",
      description: "Perform deep analysis on complex technical or business queries.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The complex query to analyze"
          },
          analysis_type: {
            type: "string",
            description: "Type of analysis needed (technical, business, creative, planning)"
          }
        },
        required: ["query", "analysis_type"],
        additionalProperties: false
      }
    }
  }
];

// Supervisor tool response handler
function getSupervisorToolResponse(functionName: string, args: any) {
  switch (functionName) {
    case "lookupKnowledgeBase":
      return {
        topic: args.topic,
        results: [
          {
            id: "KB-001",
            title: `Knowledge about ${args.topic}`,
            content: `This is detailed information about ${args.topic}. The knowledge base contains comprehensive documentation and best practices for this topic.`
          }
        ]
      };
    case "analyzeComplexQuery":
      return {
        query: args.query,
        analysis_type: args.analysis_type,
        insights: [
          "This query requires multi-step reasoning",
          "Key considerations have been identified",
          "Recommended approach has been formulated"
        ],
        recommendations: "Based on the analysis, here are the recommended next steps..."
      };
    default:
      return { result: "Function executed successfully" };
  }
}

// Handle iterative function calls like reference implementation
async function handleSupervisorToolCalls(
  body: any,
  response: any,
  addBreadcrumb?: (title: string, data?: any) => void
) {
  let currentResponse = response;

  while (true) {
    if (currentResponse?.error) {
      return { error: 'Something went wrong.' };
    }

    const outputItems: any[] = currentResponse.choices?.[0]?.message?.tool_calls ?? [];

    if (outputItems.length === 0) {
      // No more function calls - return final response
      const finalText = currentResponse.choices?.[0]?.message?.content || "Supervisor agent completed.";
      return finalText;
    }

    // Execute each function call
    const toolMessages = [];
    for (const toolCall of outputItems) {
      const functionName = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments || '{}');
      const toolResult = getSupervisorToolResponse(functionName, args);

      // Add breadcrumbs for supervisor function calls
      if (addBreadcrumb) {
        addBreadcrumb(`[supervisorAgent] function call: ${functionName}`, args);
        addBreadcrumb(`[supervisorAgent] function call result: ${functionName}`, toolResult);
      }

      toolMessages.push({
        tool_call_id: toolCall.id,
        role: "tool" as const,
        content: JSON.stringify(toolResult)
      });
    }

    // Add tool results to conversation and make follow-up request
    body.messages.push(
      currentResponse.choices[0].message,
      ...toolMessages
    );

    // Make follow-up request with tool results
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    currentResponse = await openai.chat.completions.create(body);
  }
}

// Supervisor Agent Function - Escalates to heavy model with nested function call support
functions.push({
  schema: {
    name: "getNextResponseFromSupervisor",
    type: "function",
    description: "Escalate complex queries to a supervisor agent with advanced reasoning capabilities and access to specialized tools. Use this for multi-step planning, complex analysis, technical questions, or when you need deeper reasoning beyond simple chat.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The user's query or request that needs supervisor-level reasoning"
        },
        context: {
          type: "string",
          description: "Additional context from the conversation that might be relevant"
        },
        reasoning_type: {
          type: "string",
          description: "The type of reasoning required (analysis, planning, technical, creative, problem_solving)"
        }
      },
      required: ["query", "reasoning_type"]
    }
  },
  handler: async (args: { query: string; context?: string; reasoning_type: string }, addBreadcrumb?: (title: string, data?: any) => void) => {
    try {
      console.log(`🧠 Supervisor agent called for ${args.reasoning_type} reasoning`);
      
      const supervisorInstructions = `You are a supervisor AI agent with advanced reasoning capabilities and access to specialized tools.

You can call the following tools when needed:
- lookupKnowledgeBase: Search for information by topic
- analyzeComplexQuery: Perform deep analysis on complex queries

Query Type: ${args.reasoning_type}
User Query: ${args.query}
${args.context ? `Context: ${args.context}` : ''}

Provide a comprehensive, well-reasoned response. Use tools when additional information or analysis would be helpful. Be thorough but concise.`;
      
      console.log(`🤖 Calling supervisor model (gpt-4.1) for ${args.reasoning_type} reasoning...`);
      
      // Initial request body for supervisor agent
      const body = {
        model: "gpt-4.1",
        messages: [
          {
            role: "system" as const,
            content: "You are a supervisor AI agent with advanced reasoning capabilities. You have access to specialized tools for knowledge lookup and complex analysis. Use these tools when they would help provide better answers."
          },
          {
            role: "user" as const,
            content: supervisorInstructions
          }
        ],
        tools: supervisorTools,
        tool_choice: "auto" as const,
        max_tokens: 1500,
        temperature: 0.3
      };
      
      // Call supervisor model with tool support
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const initialResponse = await openai.chat.completions.create(body);
      
      // Handle iterative function calls
      const finalResponse = await handleSupervisorToolCalls(body, initialResponse, addBreadcrumb);
      
      if (typeof finalResponse === 'string') {
        console.log(`✅ Supervisor response received (${finalResponse.length} chars)`);
        return JSON.stringify({
          response: finalResponse,
          reasoning_type: args.reasoning_type,
          escalated: true,
          model: "gpt-4.1"
        });
      } else {
        console.error("❌ Error in supervisor tool calls:", finalResponse);
        return JSON.stringify({
          error: "Supervisor agent encountered an error",
          escalated: false
        });
      }
      
    } catch (error) {
      console.error("❌ Error in supervisor agent:", error);
      return JSON.stringify({
        error: "Failed to get supervisor response",
        escalated: false
      });
    }
  }
});

export default functions;
