export const SERVICE = "chatgpt";
export const SITE_LABEL = "ChatGPT";
export const FORMAT_VERSION = 2;
export const EXPORTER_VERSION = "extension-0.1.0";

export type Role = "user" | "assistant";

export interface FeatureFlags {
  has_code_block: boolean;
  has_inline_code: boolean;
  has_table: boolean;
  has_link: boolean;
  has_list: boolean;
  has_math: boolean;
  has_blockquote: boolean;
  link_count: number;
  table_count: number;
  code_block_count: number;
  text_length: number;
}

export interface CandidateScore {
  score: number;
  reasons: string[];
}

export interface ChatMessage {
  id: string;
  role: Role;
  clipboard_text: string;
  clipboard_html: string;
  dom_markdown: string;
  dom_html: string;
  dom_text: string;
  final_markdown: string;
  selected_source: string;
  feature_flags: FeatureFlags;
  quality_score: number;
  candidate_scores: Record<string, CandidateScore>;
}

export interface ConversationExport {
  service: typeof SERVICE;
  format_version: typeof FORMAT_VERSION;
  exporter_version: typeof EXPORTER_VERSION;
  conversation_id: string;
  title: string;
  title_source: string;
  url: string;
  exported_at: string;
  message_count: number;
  scroll_debug: Record<string, unknown>;
  messages: ChatMessage[];
}

export interface ExportFile {
  filename: string;
  mimeType: string;
  content: string;
}

export interface ExportBundle {
  baseName: string;
  conversation: ConversationExport;
  files: ExportFile[];
}

export interface PageStatus {
  ok: boolean;
  url: string;
  conversationId?: string;
  reason?: string;
}

export interface ExportSuccessResponse {
  ok: true;
  status: PageStatus;
  bundle: ExportBundle;
}

export interface ExportFailureResponse {
  ok: false;
  status: PageStatus;
  error: string;
}

export type ExportResponse = ExportSuccessResponse | ExportFailureResponse;

export interface ExportCurrentMessage {
  type: "CHAT_EXPORTER_EXPORT_CURRENT";
}

export interface ProbePageMessage {
  type: "CHAT_EXPORTER_PROBE_PAGE";
}

export type PopupMessage = ExportCurrentMessage | ProbePageMessage;
