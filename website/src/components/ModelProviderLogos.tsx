import type { ReactNode } from "react";

type Provider = {
  name: string;
  Icon: (props: { className?: string }) => ReactNode;
};

function AnthropicIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.304 3.541h-3.672l6.696 16.918h3.672L17.304 3.541zm-10.608 0L0 20.459h3.744l1.32-3.496h6.784l1.32 3.496h3.744L10.536 3.541H6.696zm-.96 10.516 2.272-5.996 2.272 5.996H6.144z" />
    </svg>
  );
}

function OpenAIIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.795.795 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.823-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.104v-5.677a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.781a.795.795 0 0 0-.785 0L9.409 9.23V6.9a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.843a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.392.681l-.003 6.742z" />
    </svg>
  );
}

function GoogleIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function FireworksIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2l1.09 3.36h3.54L14.18 7.8 15.27 11.16 12 9.09 8.73 11.16 9.82 7.8 7.37 5.36h3.54L12 2zm-6.5 8.5 2.18 1.59-.83 2.55 2.18-1.58 2.18 1.58-.83-2.55 2.18-1.59-2.69-.02-1.65-2.54zm13 0-1.65 2.54-2.69.02 2.18 1.59-.83 2.55 2.18-1.58 2.18 1.58-.83-2.55 2.18-1.59-2.69-.02-1.65-2.54zM12 14.5c1.93 0 3.5 1.57 3.5 3.5S13.93 21.5 12 21.5 8.5 19.93 8.5 18s1.57-3.5 3.5-3.5z" />
    </svg>
  );
}

const PROVIDERS: Provider[] = [
  { name: "Anthropic", Icon: AnthropicIcon },
  { name: "OpenAI", Icon: OpenAIIcon },
  { name: "Google", Icon: GoogleIcon },
  { name: "Fireworks.ai", Icon: FireworksIcon }
];

export function ModelProviderLogos() {
  return (
    <div className="mb-10 border-b border-white/5 pb-10" aria-label="Supported model providers">
      <p className="mb-6 text-center text-xs font-medium uppercase tracking-widest text-white/35">
        Works with your models
      </p>
      <ul className="flex flex-wrap items-center justify-center gap-x-8 gap-y-5 md:gap-x-12">
        {PROVIDERS.map(({ name, Icon }) => (
          <li key={name} className="flex items-center gap-2.5 text-white/50">
            <Icon className="h-6 w-6 shrink-0" />
            <span className="text-sm font-medium tracking-tight">{name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
