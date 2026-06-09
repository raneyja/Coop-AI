import React, { createContext, useContext } from "react";

export type ChatLinkHandlers = {
  onOpenFile?: (path: string, line?: number) => void;
  onOpenLink?: (url: string) => void;
};

const ChatLinkContext = createContext<ChatLinkHandlers>({});

export function ChatLinkProvider({
  children,
  onOpenFile,
  onOpenLink
}: ChatLinkHandlers & { children: React.ReactNode }): React.ReactElement {
  return (
    <ChatLinkContext.Provider value={{ onOpenFile, onOpenLink }}>{children}</ChatLinkContext.Provider>
  );
}

export function useChatLinks(): ChatLinkHandlers {
  return useContext(ChatLinkContext);
}
