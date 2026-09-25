type SetupStepperProps = {
  steps: { id: string; label: string }[];
  step: number;
};

function CheckIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 8.5L6.5 11.5L12.5 4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SetupStepper({ steps, step }: SetupStepperProps) {
  return (
    <nav className="mt-4" aria-label="Setup progress">
      <ol className="flex items-center">
        {steps.map((entry, index) => {
          const active = index === step;
          const complete = index < step;
          return (
            <li key={entry.id} className="flex min-w-0 flex-1 items-center">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${
                  active
                    ? "bg-coop-index text-coop-dark"
                    : complete
                      ? "bg-coop-index/15 text-coop-index"
                      : "border border-coop-border/80 bg-transparent text-coop-muted"
                }`}
                aria-current={active ? "step" : undefined}
              >
                {complete ? <CheckIcon /> : index + 1}
              </span>
              <span
                className={`ml-2 hidden truncate text-xs sm:inline ${
                  active ? "font-medium text-white" : complete ? "text-white/80" : "text-coop-muted"
                }`}
              >
                {entry.label}
              </span>
              {index < steps.length - 1 ? (
                <span
                  className={`mx-2 hidden h-px min-w-3 flex-1 sm:block ${
                    complete ? "bg-coop-index/40" : "bg-coop-border/70"
                  }`}
                  aria-hidden
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
