import { EventEmitter } from 'events';
import type { CompletedTurn } from './types';

export interface ConversationBusEvents {
  turn_complete: (turn: CompletedTurn) => void;
}

class ConversationBus extends EventEmitter {
  emitTurnComplete(turn: CompletedTurn) {
    this.emit('turn_complete', turn);
  }
  onTurnComplete(listener: (turn: CompletedTurn) => void) {
    this.on('turn_complete', listener);
  }
}

/** Singleton event bus. addConversationEvent() in sqlite.ts emits here after each completed turn. */
export const conversationBus = new ConversationBus();
