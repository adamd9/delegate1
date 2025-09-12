import { TranscriptContextValue } from "@/types/transcript";

// Track the current user voice message ID so interim and final transcripts
// update the same UI message instead of diverging across different item_ids
let currentVoiceUserItemId: string | null = null;
let lastFinalizedVoiceUserItemId: string | null = null;
// De-dupe function-call request breadcrumbs (streaming deltas) by call_id
const seenFunctionCallRequestBreadcrumbs = new Set<string>();
// After a session is finalized, hide any immediate ThoughtFlow artifacts so they are part of history only
let hideArtifactsUntilHistoryExpand = false;
// History anchor: ensure replayed items always render before the header
let historyAnchorMs: number | null = null;
let historyClampOffset = 0;

// Helper to set createdAtMs on the most recently added breadcrumb (e.g., after we add it)
function setLastBreadcrumbTimestamp(transcript: TranscriptContextValue, ts?: number) {
  if (!ts) return;
  try {
    const items = transcript.transcriptItems;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type === 'BREADCRUMB') {
        const adjusted = (historyAnchorMs != null && ts >= historyAnchorMs)
          ? (historyAnchorMs - (++historyClampOffset))
          : ts;
        transcript.updateTranscriptItem(it.itemId, { createdAtMs: adjusted });
        break;
      }
    }
  } catch {}
}

function isHistoryExpanded(): boolean {
  try {
    return Boolean((globalThis as any).__historyExpanded);
  } catch {
    return false;
  }
}

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
    transcriptItems,
    addTranscriptMessage, 
    updateTranscriptMessage, 
    addTranscriptBreadcrumb,
    updateTranscriptItem,
    clearTranscript,
  } = transcript;

  console.log("Enhanced event handler:", event.type, event);

  switch (event.type) {
    case "history.header": {
      const count = typeof event.count === 'number' ? event.count : 0;
      // Hide any previous headers to avoid duplication
      try {
        for (const it of transcriptItems) {
          if (it.type === 'BREADCRUMB' && typeof it.title === 'string' && it.title.startsWith('📜 Previous conversations') && !it.isHidden) {
            updateTranscriptItem(it.itemId, { isHidden: true });
          }
        }
      } catch {}
      // Non-expandable breadcrumb (no data payload)
      addTranscriptBreadcrumb(
        `📜 Previous conversations (${count})`,
        undefined
      );
      historyAnchorMs = Date.now();
      historyClampOffset = 0;
      break;
    }
    // Main conversation item handler - handles both user/assistant messages and function_call items
    case "conversation.item.created":
      if (!event.item) return;
      if (event.item.type === 'message') {
        const { id: itemId, role, content = [] } = event.item;
        const isUser = role === "user";
        const channel = event.item.channel || (isUser ? "voice" : "text");
        const supervisor = event.item.supervisor || false;
        const isReplay = event.replay === true;
        
        if (itemId && role) {
          let text = extractMessageText(content);
          
          // Handle empty user messages (transcribing)
          if (isUser && !text) {
            text = "[Transcribing...]";
          }
          
          const newId = isReplay ? `replay_${itemId}` : itemId;
          addTranscriptMessage(
            newId,
            role,
            text,
            channel,
            supervisor,
            isReplay ? !isHistoryExpanded() : false
          );
          // For replay, prefer ledger timestamp and clamp to render before header
          if (isReplay && typeof event.timestamp === 'number') {
            const ts = (historyAnchorMs != null && event.timestamp >= historyAnchorMs)
              ? (historyAnchorMs - (++historyClampOffset))
              : event.timestamp;
            updateTranscriptItem(newId, { createdAtMs: ts });
          }
          // Attach debug metadata when available
          if (isReplay && (event as any).session_id) {
            try {
              const meta = {
                session_id: (event as any).session_id,
                kind: 'message',
              } as any;
              updateTranscriptItem(newId, { data: { ...(event.item as any), _meta: meta } });
            } catch {}
          }

          // If this is a user voice message, remember its id for transcript updates
          if (isUser && channel === "voice") {
            currentVoiceUserItemId = itemId;
          }
        }
      } else if (event.item.type === 'function_call') {
        const safeName = event.item.name || (event.item.call_id ? `call ${event.item.call_id}` : 'function');
        let parsedArgs: any = event.item.arguments;
        try {
          // Arguments may be a JSON string; attempt to parse
          if (typeof parsedArgs === 'string') parsedArgs = JSON.parse(parsedArgs);
        } catch {}
        const isReplay = event.replay === true;
        // For replay, hide if history isn't expanded
        const breadcrumbHidden = Boolean(isReplay && !isHistoryExpanded());
        // If the function includes a normalized query, reflect it in the last finalized user voice message
        if (parsedArgs && typeof parsedArgs.query === 'string' && lastFinalizedVoiceUserItemId) {
          updateTranscriptMessage(lastFinalizedVoiceUserItemId, parsedArgs.query, false);
          addTranscriptBreadcrumb(
            "📝 Normalized user query",
            {
              itemId: lastFinalizedVoiceUserItemId,
              query: parsedArgs.query,
              source: safeName,
            },
            breadcrumbHidden
          );
        }
        addTranscriptBreadcrumb(
          `🔧 Function call: ${safeName}`,
          {
            name: event.item.name,
            call_id: event.item.call_id,
            arguments: parsedArgs,
            status: event.item.status || 'created',
            _replay: breadcrumbHidden,
          },
          breadcrumbHidden
        );
        if (isReplay && typeof event.timestamp === 'number') setLastBreadcrumbTimestamp(transcript, event.timestamp);
        // Attach debug metadata
        if (isReplay) {
          try {
            const meta = {
              session_id: (event as any).session_id,
              run_id: (event as any).run_id,
              step_id: (event as any).step_id,
              call_id: event.item.call_id,
              kind: 'function_call',
            } as any;
            // Update the most recent breadcrumb we just added
            const items = transcript.transcriptItems;
            const last = items[items.length - 1];
            if (last && last.type === 'BREADCRUMB') {
              updateTranscriptItem(last.itemId, { data: { ...(last.data || {}), _meta: meta } });
            }
          } catch {}
        }
      }
      break;

    // User voice transcription streaming (input side)
    case "conversation.item.input_audio_transcription.delta": {
      const id = event.item_id;
      const delta: string = event.delta || "";
      if (!id || !delta) break;
      currentVoiceUserItemId = id;
      // Ensure a user voice message exists, then append delta
      addTranscriptMessage(
        id,
        "user",
        "",
        "voice",
        false,
        false
      );
      updateTranscriptMessage(id, delta, true);
      break;
    }

    // Assistant text streaming (non-voice)
    case "response.output_text.delta": {
      const id = event.item_id || event.response_id;
      const delta: string = event.delta || "";
      if (!id || !delta) break;
      // Ensure assistant message exists, then append delta
      addTranscriptMessage(
        id,
        "assistant",
        "",
        "text",
        false,
        false
      );
      updateTranscriptMessage(id, delta, true);
      break;
    }

    case "response.output_text.done": {
      const id = event.item_id || event.response_id;
      const text: string = event.text || "";
      if (!id || !text) break;
      // Replace with final text
      addTranscriptMessage(
        id,
        "assistant",
        "",
        "text",
        false,
        false
      );
      updateTranscriptMessage(id, text, false);
      break;
    }

    case "conversation.item.completed":
      if (!event.item) return;
      if (event.item.type === 'function_call') {
        const safeName = event.item.name || (event.item.call_id ? `call ${event.item.call_id}` : 'function');
        let parsedArgs: any = event.item.arguments;
        try {
          if (typeof parsedArgs === 'string') parsedArgs = JSON.parse(parsedArgs);
        } catch {}
        const isReplay = event.replay === true;
        if (parsedArgs && typeof parsedArgs.query === 'string' && lastFinalizedVoiceUserItemId) {
          updateTranscriptMessage(lastFinalizedVoiceUserItemId, parsedArgs.query, false);
          addTranscriptBreadcrumb(
            "📝 Normalized user query",
            {
              itemId: lastFinalizedVoiceUserItemId,
              query: parsedArgs.query,
              source: safeName,
            },
            isReplay
          );
        }
        addTranscriptBreadcrumb(
          `✅ Function call completed: ${safeName}`,
          {
            name: event.item.name,
            call_id: event.item.call_id,
            arguments: parsedArgs,
            status: 'completed',
            _replay: isReplay,
          },
          isReplay
        );
        if (isReplay && typeof event.timestamp === 'number') setLastBreadcrumbTimestamp(transcript, event.timestamp);
      }
      break;

    // Response deltas (streaming)
    case "response.output_item.done":
      if (event.item?.content?.[0]?.text) {
        const id = event.item.id;
        const text = event.item.content[0].text;
        // Ensure assistant message exists, then set final text
        addTranscriptMessage(
          id,
          "assistant",
          "",
          "text",
          false,
          false
        );
        updateTranscriptMessage(id, text, false);
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
      // This is the MODEL's spoken audio transcript (assistant output)
      if (typeof event?.delta === 'string' && event.delta.length > 0) {
        const targetId = event.item_id; // assistant item id
        if (targetId) {
          // Ensure an assistant message exists, then append delta
          addTranscriptMessage(
            targetId,
            "assistant",
            "",
            "voice",
            false,
            false
          );
          updateTranscriptMessage(
            targetId,
            event.delta,
            true
          );
        }
      }
      break;

    // Voice transcription completion
    case "conversation.item.input_audio_transcription.completed": {
      const transcriptionItemId = event.item_id;
      const finalTranscript = !event.transcript || event.transcript === "\n"
        ? "[inaudible]"
        : event.transcript;

      const targetId = currentVoiceUserItemId || transcriptionItemId;
      if (targetId) {
        // Ensure the message exists before updating to final text
        addTranscriptMessage(
          targetId,
          "user",
          "",
          "voice",
          false,
          false
        );
        console.log("Updating transcription for:", targetId, "with:", finalTranscript);
        updateTranscriptMessage(targetId, finalTranscript, false);

        if (finalTranscript !== "[inaudible]" && finalTranscript.length > 0) {
          addTranscriptBreadcrumb(
            "🎤 Transcription completed",
            {
              itemId: targetId,
              transcript: finalTranscript,
            }
          );
        }
        // Clear current voice pointer after finalization
        currentVoiceUserItemId = null;
        lastFinalizedVoiceUserItemId = targetId;
      }
      break;
    }

    // Function call request (early breadcrumb)
    case "response.function_call_arguments.delta": {
      const safeName = event?.name || (event?.call_id ? `call ${event.call_id}` : "function");
      // Parse arguments for readability; tolerate non-JSON
      let parsedArgs: any = event?.arguments;
      try {
        if (typeof parsedArgs === "string") parsedArgs = JSON.parse(parsedArgs);
      } catch {}
      // De-duplicate: add once per call_id to avoid delta spam
      const callId: string = event?.call_id || `${safeName}:${JSON.stringify(parsedArgs ?? {})}`;
      if (!seenFunctionCallRequestBreadcrumbs.has(callId)) {
        seenFunctionCallRequestBreadcrumbs.add(callId);
        addTranscriptBreadcrumb(
          `🛠️ Function call requested: ${safeName}`,
          {
            name: event?.name,
            call_id: event?.call_id,
            arguments: parsedArgs ?? event?.arguments,
          }
        );
      }
      break;
    }

    case "response.function_call_arguments.done": {
      const safeName = event?.name || (event?.call_id ? `call ${event.call_id}` : "function");
      // Try to parse arguments to capture normalized user query
      let parsedArgs: any = event?.arguments;
      try {
        if (typeof parsedArgs === 'string') parsedArgs = JSON.parse(parsedArgs);
      } catch {}
      if (parsedArgs && typeof parsedArgs.query === 'string' && lastFinalizedVoiceUserItemId) {
        updateTranscriptMessage(lastFinalizedVoiceUserItemId, parsedArgs.query, false);
        addTranscriptBreadcrumb(
          "📝 Normalized user query",
          {
            itemId: lastFinalizedVoiceUserItemId,
            query: parsedArgs.query,
            source: safeName,
          }
        );
      }
      addTranscriptBreadcrumb(
        `✅ Function call completed: ${safeName}`,
        {
          name: event?.name,
          arguments: event?.arguments,
          call_id: event?.call_id,
          status: "completed",
          result: event?.result,
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

    // ThoughtFlow artifacts (JSON + D2) after session finalization
    case "thoughtflow.artifacts": {
      const shouldHide = (event.replay === true && !isHistoryExpanded()) || hideArtifactsUntilHistoryExpand;
      addTranscriptBreadcrumb(
        `🔧 ThoughtFlow artifacts written`,
        {
          json_path: event.json_path,
          d2_path: event.d2_path,
          url_json: event.url_json,
          url_d2: event.url_d2,
          url_d2_raw: event.url_d2_raw,
          url_d2_viewer: event.url_d2_viewer,
          timestamp: event.timestamp,
          note: "Artifacts written on server under websocket-server/runtime-data/thoughtflow",
          _replay: shouldHide,
        },
        shouldHide
      );
      if ((event.replay === true) && typeof event.timestamp === 'number') setLastBreadcrumbTimestamp(transcript, event.timestamp);
      if ((event.replay === true)) {
        try {
          const meta = {
            session_id: (event as any).session_id,
            run_id: (event as any).run_id,
            kind: 'thoughtflow_artifacts',
          } as any;
          const items = transcript.transcriptItems;
          const last = items[items.length - 1];
          if (last && last.type === 'BREADCRUMB') {
            updateTranscriptItem(last.itemId, { data: { ...(last.data || {}), _meta: meta } });
          }
        } catch {}
      }
      break;
    }

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
          title: event.title,
          timestamp: event.timestamp,
          supervisor: event.supervisor || false,
          _replay: event.replay === true,
        },
        event.replay === true && !isHistoryExpanded()
      );
      if ((event.replay === true) && typeof event.timestamp === 'number') setLastBreadcrumbTimestamp(transcript, event.timestamp);
      if ((event.replay === true)) {
        try {
          const meta = {
            session_id: (event as any).session_id,
            kind: 'canvas',
          } as any;
          const items = transcript.transcriptItems;
          const last = items[items.length - 1];
          if (last && last.type === 'BREADCRUMB') {
            updateTranscriptItem(last.itemId, { data: { ...(last.data || {}), _meta: meta } });
          }
        } catch {}
      }
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

  // When the session is finalized, hide all current (non-replay) items from the main thread
  if (event.type === 'session.finalized') {
    try {
      // Strong guarantee: clear current thread immediately
      clearTranscript();
      // Hide any immediately-following artifacts; they will appear under history
      hideArtifactsUntilHistoryExpand = true;
    } catch {}
  }
}
