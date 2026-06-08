type LegalLayoutProps = {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
};

export function LegalLayout({ title, lastUpdated, children }: LegalLayoutProps) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-16 md:py-24">
      <header className="mb-12 border-b border-coop-border pb-8">
        <h1 className="text-4xl font-semibold tracking-tight text-white">{title}</h1>
        <p className="mt-3 text-sm text-coop-muted">Last updated: {lastUpdated}</p>
      </header>
      <div className="prose prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-coop-index max-w-none">
        {children}
      </div>
    </article>
  );
}
