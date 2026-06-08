type StoryComposerProps = {
  showComposer: boolean;
  typedQuestion: string;
  isTyping?: boolean;
  isSubmitting?: boolean;
};

export function StoryComposer({
  showComposer,
  typedQuestion,
  isTyping = false,
  isSubmitting = false
}: StoryComposerProps) {
  const canSend = typedQuestion.trim().length > 0;

  return (
    <div>
      <div
        className={`rounded-xl bg-[#252526] ring-1 transition duration-150 ${
          showComposer
            ? isSubmitting
              ? "ring-[#424242] bg-[#2a2a2a]"
              : "ring-[#323232]"
            : "opacity-55 ring-[#2a2a2a]"
        }`}
      >
        <div className="px-3 pt-2.5">
          {showComposer ? (
            <p className="min-h-[2.75rem] text-[13px] leading-relaxed text-[#e5e5e5]">
              {typedQuestion || <span className="text-[#9d9d9d]">Ask Coop</span>}
              {isTyping ? (
                <span className="story-cursor ml-px inline-block h-[1em] w-[2px] translate-y-[1px] bg-coop-index" />
              ) : null}
            </p>
          ) : (
            <p className="min-h-[2.75rem] text-[13px] text-[#9d9d9d]">Ask Coop</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
          <div className="flex items-center gap-0.5 text-[#9d9d9d]">
            <span className="flex h-7 w-7 items-center justify-center rounded opacity-50" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M3 7h5l2 2h11v8H3V7z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded opacity-50" aria-hidden>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 1 1-2.83-2.83l8.49-8.48"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>
          <span
            className={`flex h-7 w-7 items-center justify-center rounded transition ${
              isSubmitting && canSend
                ? "bg-[#0078d4] text-white"
                : canSend && showComposer
                  ? "bg-[#333333] text-[#cccccc]"
                  : "bg-[#2d2d2d] text-[#666666]"
            }`}
            aria-hidden
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 12h12M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>
      </div>
      <p className="mt-1 text-center text-[10px] text-[#9d9d9d]/70">
        {typedQuestion.length}/12000 · Shift+Enter for new line
      </p>
    </div>
  );
}
