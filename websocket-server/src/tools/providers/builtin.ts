import { registerTools } from "../registry";

export function registerBuiltinTools() {
  const providerId = 'builtin';
  // Currently only web_search builtin
  registerTools(providerId, [
    {
      name: 'web_search',
      description: 'Search the web for up-to-date information.',
      parameters: {},
      origin: 'builtin',
      tags: ['builtin', 'supervisor-allowed'],
      // Builtins are executed by the model provider; handler is a no-op
      handler: async () => ''
    }
  ]);
}
