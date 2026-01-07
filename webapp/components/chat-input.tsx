"use client";

import React, { useState, useRef, useEffect } from "react";
import { Send, MessageSquare } from "lucide-react";
import styles from "./chat-input.module.css";
import mobileFix from "./chat-input.mobilefix.module.css";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'connecting';
}

const ChatInput: React.FC<ChatInputProps> = ({ 
  onSendMessage, 
  disabled = false, 
  connectionStatus 
}) => {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !disabled && connectionStatus === 'connected') {
      onSendMessage(message.trim());
      setMessage("");
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };


  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [message]);

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected': return 'text-green-600';
      case 'connecting': return 'text-yellow-600';
      case 'disconnected': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusText = () => {
    switch (connectionStatus) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'disconnected': return 'Disconnected';
      default: return 'Unknown';
    }
  };

  return (
    <div className={`border-t bg-white ${mobileFix.chatInputMobileFixed}`}>
      {/* Status Bar */}
      <div className="px-4 py-2 border-b bg-gray-50">
        <div className="flex items-center gap-2 text-sm">
          <MessageSquare className="w-4 h-4" />
          <span className="font-medium">Text Chat</span>
          <span className={`ml-auto ${getStatusColor()}`}>
            {getStatusText()}
          </span>
        </div>
      </div>

      {/* Chat Input */}
      <form onSubmit={handleSubmit} className="p-4">
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                connectionStatus === 'connected' 
                  ? "Type your message..."
                  : connectionStatus === 'connecting'
                  ? "Connecting to chat..."
                  : "Chat disconnected"
              }
              disabled={disabled || connectionStatus !== 'connected'}
              className={`
                w-full px-3 py-2 border rounded-lg resize-none overflow-y-auto
                min-h-[40px] max-h-[120px] transition-all duration-200
                ${disabled || connectionStatus !== 'connected' 
                  ? 'bg-gray-100 text-gray-500 cursor-not-allowed' 
                  : 'bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
                }
              `}
              rows={1}
            />
          </div>
          <button
            type="submit"
            disabled={!message.trim() || disabled || connectionStatus !== 'connected'}
            className={`
              px-4 py-2 rounded-lg font-medium transition-all duration-200
              flex items-center gap-2 min-w-[80px] justify-center
              ${!message.trim() || disabled || connectionStatus !== 'connected'
                ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
              }
            `}
          >
            <Send className="w-4 h-4" />
            Send
          </button>
        </div>

        {connectionStatus === 'connected' && (
          <div className="mt-2 text-xs text-gray-400">
            Enter to send • Shift+Enter for new line
          </div>
        )}

        {/* Helper Text */}
        <div className="mt-2 text-xs text-gray-500">
          {connectionStatus === 'connected' && (
            "This chat shares the same conversation session as voice calls"
          )}
          {connectionStatus === 'disconnected' && (
            "Complete the setup checklist above to enable chat"
          )}
        </div>
      </form>
    </div>
  );
};

export default ChatInput;
