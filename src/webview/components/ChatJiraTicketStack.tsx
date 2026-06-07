import React from "react";
import type { ChatJiraTicket } from "../lib/chatProseTypes";

type ChatJiraTicketStackProps = {
  tickets: ChatJiraTicket[];
};

export function ChatJiraTicketStack({ tickets }: ChatJiraTicketStackProps): React.ReactElement {
  return (
    <div className="coop-chat-jira-stack" role="list" aria-label="Jira tickets">
      {tickets.map((ticket) => (
        <article key={ticket.key} className="coop-chat-jira-ticket" role="listitem">
          <header className="coop-chat-jira-ticket-header">
            <a href={ticket.url} target="_blank" rel="noreferrer" className="coop-chat-jira-ticket-key">
              {ticket.key}
            </a>
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
