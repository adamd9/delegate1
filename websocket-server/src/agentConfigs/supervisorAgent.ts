import { FunctionHandler } from './types';
import { supervisorAgentConfig } from './supervisorAgentConfig';
import { ResponsesTextInput } from '../types';
// Orchestrator moved to centralized location
import { handleSupervisorToolCalls } from '../tools/orchestrators/supervisor';

import { getSchemasForAgent, executeBySanitizedName } from '../tools/registry';

// (Legacy supervisor tool router removed; centralized registry now handles execution)
export { handleSupervisorToolCalls };

// Main supervisor function that escalates to heavy model
export { getNextResponseFromSupervisorFunction } from '../tools/handlers/supervisor-escalation';

// Import the supervisor agent configuration
export { supervisorAgentConfig as supervisorAgent } from './supervisorAgentConfig';
