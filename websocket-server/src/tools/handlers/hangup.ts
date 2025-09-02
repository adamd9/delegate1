import { FunctionHandler } from '../../agentConfigs/types';
import { session, jsonSend, closeAllConnections, isOpen } from '../../session/state';

export const hangupCallTool: FunctionHandler = {
  schema: {
    name: 'hang_up',
    type: 'function',
    description: 'End the current voice call with the user.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  handler: async () => {
    if (session.twilioConn && isOpen(session.twilioConn)) {
      jsonSend(session.twilioConn, { event: 'close' });
    }
    closeAllConnections();
    return { status: 'closed' };
  },
};

export default hangupCallTool;
