import { TranscriptContextValue } from "@/types/transcript";

// Helper function to extract text content from conversation items
function extractMessageText(content: any[] = []): string {
  if (!Array.isArray(content)) return "";
  
  return content
    .map((c) => {
      if (!c || typeof c !== "object") return "";
      if (c.type === "text") return c.text ?? "";
      if (c.type === "input_text") return c.text ?? "";
      if (c.type === "audio") return c.transcript ?? "";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export default function handleEnhancedRealtimeEvent(
  event: any,
  transcript: TranscriptContextValue
) {
  const { 
    addTranscriptMessage, 
    updateTranscriptMessage, 
    addTranscriptBreadcrumb 
  } = transcript;

  console.log("Enhanced event handler:", event.type, event);

  switch (event.type) {
    // Main conversation item handler - handles both user/assistant messages and function_call items
    case "conversation.item.created":
      if (!event.item) return;
      if (event.item.type === 'message') {
        const { id: itemId, role, content = [] } = event.item;
        const channel = event.item.channel || "voice";
        const supervisor = event.item.supervisor || false;
        
        if (itemId && role) {
          const isUser = role === "user";
          let text = extractMessageText(content);
          
          // Handle empty user messages (transcribing)
          if (isUser && !text) {
            text = "[Transcribing...]";
          }
          
          addTranscriptMessage(
            itemId,
            role,
            text,
            channel,
            supervisor,
            false
          );
        }
      } else if (event.item.type === 'function_call') {
        const safeName = event.item.name || (event.item.call_id ? `call ${event.item.call_id}` : 'function');
        let parsedArgs: any = event.item.arguments;
        try {
          // Arguments may be a JSON string; attempt to parse
          if (typeof parsedArgs === 'string') parsedArgs = JSON.parse(parsedArgs);
        } catch {}
        addTranscriptBreadcrumb(
          `🔧 Function call: ${safeName}`,
          {
            name: event.item.name,
            call_id: event.item.call_id,
            arguments: parsedArgs,
            status: event.item.status || 'created',
          }
        );
      }
      break;

    case "conversation.item.completed":
      if (!event.item) return;
      if (event.item.type === 'function_call') {
        const safeName = event.item.name || (event.item.call_id ? `call ${event.item.call_id}` : 'function');
        let parsedArgs: any = event.item.arguments;
        try {
          if (typeof parsedArgs === 'string') parsedArgs = JSON.parse(parsedArgs);
        } catch {}
        addTranscriptBreadcrumb(
          `✅ Function call completed: ${safeName}`,
          {
            name: event.item.name,
            call_id: event.item.call_id,
            arguments: parsedArgs,
            status: 'completed',
          }
        );
      }
      break;

    // Response deltas (streaming)
    case "response.output_item.done":
      if (event.item?.content?.[0]?.text) {
        updateTranscriptMessage(
          event.item.id,
          event.item.content[0].text,
          false
        );
      } else if (event.item?.type === 'function_call') {
        const safeName = event.item.name || (event.item.call_id ? `call ${event.item.call_id}` : 'function');
        let parsedArgs: any = event.item.arguments;
        try {
          if (typeof parsedArgs === 'string') parsedArgs = JSON.parse(parsedArgs);
        } catch {}
        addTranscriptBreadcrumb(
          `✅ Function call completed: ${safeName}`,
          {
            name: event.item.name,
            call_id: event.item.call_id,
            arguments: parsedArgs,
            status: event.item.status || 'completed',
          }
        );
      }
      break;

    case "response.audio_transcript.delta":
      if (event.delta) {
        updateTranscriptMessage(
          event.item_id || `voice_${Date.now()}`,
          event.delta,
          true
        );
      }
      break;

    // Voice transcription completion
    case "conversation.item.input_audio_transcription.completed":
      const transcriptionItemId = event.item_id;
      const finalTranscript = !event.transcript || event.transcript === "\n"
        ? "[inaudible]"
        : event.transcript;
      
      if (transcriptionItemId) {
        console.log("Updating transcription for:", transcriptionItemId, "with:", finalTranscript);
        updateTranscriptMessage(transcriptionItemId, finalTranscript, false);
        
        // Only add breadcrumb for transcription completion if it's interesting
        // (Don't clutter with every transcription update)
        if (finalTranscript !== "[inaudible]" && finalTranscript.length > 0) {
          addTranscriptBreadcrumb(
            "🎤 Transcription completed",
            {
              itemId: transcriptionItemId,
              transcript: finalTranscript
            }
          );
        }
      }
      break;

    // Function calls
    case "response.function_call_arguments.delta":
      // Suppress delta breadcrumbs to avoid noisy spam and undefined names
      // You can re-enable with a guard if you want to visualize streaming args
      // if (event?.name) {
      //   addTranscriptBreadcrumb(`🔧 Function call: ${event.name}`, {
      //     name: event.name,
      //     arguments: event.arguments,
      //     call_id: event.call_id,
      //   });
      // }
      break;

    case "response.function_call_arguments.done": {
      const safeName = event?.name || (event?.call_id ? `call ${event.call_id}` : "function");
      addTranscriptBreadcrumb(
        `✅ Function call completed: ${safeName}`,
        {
          name: event?.name,
          arguments: event?.arguments,
          call_id: event?.call_id,
          status: "completed",
        }
      );
      break;
    }

    // Session events
    case "session.created":
      addTranscriptBreadcrumb(
        "🔗 Session started",
        {
          session_id: event.session?.id,
          timestamp: new Date().toISOString()
        }
      );
      break;

    case "session.updated":
      addTranscriptBreadcrumb(
        "⚙️ Session configuration updated",
        {
          session: event.session
        }
      );
      break;

    // Connection events
    case "connection.established":
      addTranscriptBreadcrumb(
        "🔌 Connection established",
        {
          timestamp: new Date().toISOString()
        }
      );
      break;

    case "connection.closed":
      addTranscriptBreadcrumb(
        "🔌 Connection closed",
        {
          timestamp: new Date().toISOString()
        }
      );
      break;

    // Error events
    case "error":
      addTranscriptBreadcrumb(
        `❌ Error: ${event.error?.message || "Unknown error"}`,
        {
          error: event.error,
          timestamp: new Date().toISOString()
        }
      );
      break;

    // Chat events (text channel)
    case "chat.response":
      const chatSupervisor = event.supervisor || false;
      addTranscriptMessage(
        `chat_${event.timestamp}`,
        "assistant",
        event.content,
        "text",
        chatSupervisor,
        false
      );

      // Add breadcrumb for chat response
      const chatBreadcrumbTitle = chatSupervisor
        ? "🧠 Supervisor chat response"
        : "💬 Chat response";

      addTranscriptBreadcrumb(
        chatBreadcrumbTitle,
        {
          content: event.content,
          timestamp: event.timestamp,
          supervisor: chatSupervisor
        }
      );
      break;

    case "chat.canvas":
      addTranscriptBreadcrumb(
        "📝 Canvas response",
        {
          content: event.content,
          timestamp: event.timestamp,
          supervisor: event.supervisor || false
        }
      );
      break;

    case "chat.error":
      addTranscriptBreadcrumb(
        `❌ Chat error: ${event.error}`,
        {
          error: event.error,
          timestamp: event.timestamp
        }
      );
      break;

    // Voice events
    case "input_audio_buffer.speech_started":
      addTranscriptBreadcrumb(
        "🎤 Speech started",
        {
          timestamp: new Date().toISOString()
        }
      );
      break;

    case "input_audio_buffer.speech_stopped":
      addTranscriptBreadcrumb(
        "🎤 Speech stopped",
        {
          timestamp: new Date().toISOString()
        }
      );
      break;

    // Default case for unknown events
    default:
      console.log("Unhandled event type:", event.type);
      break;
  }
}
