import React from "react";
import type { ChatJiraTicket } from "../lib/chatProseTypes";
import { ChatActionLink } from "./ChatActionLink";
import { useChatLinks } from "./ChatLinkContext";

type ChatJiraTicketStackProps = {
  tickets: ChatJiraTicket[];
  onOpenLink?: (url: string) => void;
};

export function ChatJiraTicketStack({
  tickets,
  onOpenLink
}: ChatJiraTicketStackProps): React.ReactElement {
  const contextLinks = useChatLinks();
  const openLink = onOpenLink ?? contextLinks.onOpenLink;

  return (
    <div className="coop-chat-jira-stack" role="list" aria-label="Jira tickets">
      {tickets.map((ticket) => (
        <article key={ticket.key} className="coop-chat-jira-ticket" role="listitem">
          <header className="coop-chat-jira-ticket-header">
            <ChatActionLink
              kind="external"
              label={ticket.key}
              className="coop-chat-jira-ticket-key"
              onClick={() => openLink?.(ticket.url)}
            />
            {ticket.summary ? <p className="coop-chat-jira-ticket-summary">{ticket.summary}</p> : null}
          </header>
          {ticket.fields.length > 0 ? (
            <dl className="coop-chat-jira-ticket-meta">
              {ticket.fields.map((field) => (
                <div key={`${ticket.key}-${field.label}`} className="coop-chat-jira-ticket-meta-row">
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </article>
      ))}
    </div>
  );
}
