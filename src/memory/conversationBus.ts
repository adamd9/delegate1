import { EventEmitter } from 'events';
import type { CompletedTurn, CompletedConversation } from './types';

export interface ConversationBusEvents {
  turn_complete: (turn: CompletedTurn) => void;
  conversation_complete: (conv: CompletedConversation) => void;
}

class ConversationBus extends EventEmitter {
  emitTurnComplete(turn: CompletedTurn) {
    this.emit('turn_complete', turn);
  }
  onTurnComplete(listener: (turn: CompletedTurn) => void) {
    this.on('turn_complete', listener);
  }
  emitConversationComplete(conv: CompletedConversation) {
    this.emit('conversation_complete', conv);
  }
  onConversationComplete(listener: (conv: CompletedConversation) => void) {
    this.on('conversation_complete', listener);
  }
}

/** Singleton event bus. addConversationEvent() in sqlite.ts emits here after each completed turn. */
export const conversationBus = new ConversationBus();
