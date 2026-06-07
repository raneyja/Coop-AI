export type ChatInlineNode =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "inline-code"; code: string }
  | { type: "file-link"; path: string; line?: number; label: string }
  | { type: "external-link"; label: string; url: string };

export type ChatSectionHeadingBlock = {
  type: "section-heading";
  text: string;
};

export type ChatCodeFenceBlock = {
  type: "code-fence";
  language?: string;
  code: string;
};

export type ChatCodeCitationBlock = {
  type: "code-citation";
  startLine: number;
  endLine: number;
  path: string;
  code: string;
};

export type ChatListItem = {
  marker: "-" | "*" | "ordered";
  order?: number;
  content: ChatInlineNode[];
};

export type ChatListBlock = {
  type: "list";
  items: ChatListItem[];
};

export type ChatParagraphBlock = {
  type: "paragraph";
  content: ChatInlineNode[];
};

export type ChatJiraTicketField = {
  label: string;
  value: string;
};

export type ChatJiraTicket = {
  key: string;
  url: string;
  summary?: string;
  fields: ChatJiraTicketField[];
};

export type ChatJiraTicketStackBlock = {
  type: "jira-ticket-stack";
  tickets: ChatJiraTicket[];
};

export type ChatProseBlock =
  | ChatSectionHeadingBlock
  | ChatCodeFenceBlock
  | ChatCodeCitationBlock
  | ChatListBlock
  | ChatParagraphBlock
  | ChatJiraTicketStackBlock;

export type ChatProseDocument = {
  blocks: ChatProseBlock[];
};
