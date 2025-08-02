import { AgentConfig, FunctionHandler } from './types';

// Weather function - basic utility function
export const getWeatherFunction: FunctionHandler = {
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
};

// Base Agent Configuration
export const baseAgent: AgentConfig = {
  name: "delegate_base",
  instructions: `You are Delegate 1, a helpful AI assistant that can handle multiple types of conversations and tasks.

You have access to various tools and can escalate complex queries to a supervisor agent when needed.

Key capabilities:
- Answer general questions and have conversations
- Get weather information when provided coordinates
- Escalate complex queries to supervisor for detailed research and analysis
- Handle both voice and text conversations seamlessly

Always be helpful, concise, and professional in your responses.`,
  voice: "ballad",
  tools: [getWeatherFunction],
  model: "gpt-4o-realtime-preview-2024-10-01",
  temperature: 0.8,
};
