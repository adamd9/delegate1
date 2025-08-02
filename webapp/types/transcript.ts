// Enhanced transcript types based on reference implementation

export interface TranscriptItem {
  itemId: string;
  type: "MESSAGE" | "BREADCRUMB";
  role?: "user" | "assistant";
  title?: string;
  data?: Record<string, any>;
  expanded: boolean;
  timestamp: string;
  createdAtMs: number;
  status: "IN_PROGRESS" | "DONE";
  isHidden: boolean;
  channel?: "voice" | "text";
  supervisor?: boolean;
}

export interface TranscriptContextValue {
  transcriptItems: TranscriptItem[];
  addTranscriptMessage: (
    itemId: string,
    role: "user" | "assistant",
    text: string,
    channel?: "voice" | "text",
    supervisor?: boolean,
    isHidden?: boolean
  ) => void;
  updateTranscriptMessage: (itemId: string, text: string, isDelta: boolean) => void;
  addTranscriptBreadcrumb: (title: string, data?: Record<string, any>) => void;
  toggleTranscriptItemExpand: (itemId: string) => void;
  updateTranscriptItem: (itemId: string, updatedProperties: Partial<TranscriptItem>) => void;
  clearTranscript: () => void;
}
