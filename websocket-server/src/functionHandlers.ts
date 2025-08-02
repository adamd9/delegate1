import { FunctionHandler } from "./types";

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

// Supervisor Agent Function - Escalates to heavy model for complex reasoning
functions.push({
  schema: {
    name: "getNextResponseFromSupervisor",
    type: "function",
    description: "Escalate complex queries to a supervisor agent with advanced reasoning capabilities. Use this for multi-step planning, complex analysis, technical questions, or when you need deeper reasoning beyond simple chat.",
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
  handler: async (args: { query: string; context?: string; reasoning_type: string }) => {
    try {
      console.log(`🧠 Escalating to supervisor agent: ${args.reasoning_type} - ${args.query.substring(0, 100)}...`);
      
      // Import OpenAI here to avoid circular dependencies
      const OpenAI = require('openai');
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
      
      // Build supervisor context
      const supervisorPrompt = `You are a supervisor AI agent with advanced reasoning capabilities. You have been called by a fast chat agent to handle a complex query that requires deeper analysis.

Query Type: ${args.reasoning_type}
User Query: ${args.query}
${args.context ? `Context: ${args.context}` : ''}

Provide a comprehensive, well-reasoned response. Be thorough but concise. If this requires multiple steps, break them down clearly.`;
      
      console.log(`🤖 Calling supervisor model (gpt-4) for ${args.reasoning_type} reasoning...`);
      
      // Call heavy supervisor model
      const completion = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are a supervisor AI agent with advanced reasoning capabilities. Provide thorough, well-structured responses to complex queries. Use clear formatting and break down complex topics into digestible parts."
          },
          {
            role: "user",
            content: supervisorPrompt
          }
        ],
        max_tokens: 1500,
        temperature: 0.3, // Lower temperature for more focused reasoning
      });
      
      const supervisorResponse = completion.choices[0]?.message?.content;
      
      if (supervisorResponse) {
        console.log(`✅ Supervisor response received (${supervisorResponse.length} chars)`);
        return JSON.stringify({
          response: supervisorResponse,
          reasoning_type: args.reasoning_type,
          escalated: true,
          model: "gpt-4"
        });
      } else {
        console.error("❌ No response from supervisor model");
        return JSON.stringify({
          error: "Supervisor agent did not provide a response",
          escalated: false
        });
      }
      
    } catch (error) {
      console.error("❌ Error in supervisor agent:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      return JSON.stringify({
        error: `Supervisor agent error: ${errorMessage}`,
        escalated: false
      });
    }
  }
});

export default functions;
