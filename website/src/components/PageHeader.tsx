type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
};

export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <div className="mx-auto max-w-3xl px-6 pt-16 pb-12 text-center md:pt-24">
      {eyebrow && (
        <p className="text-sm font-medium uppercase tracking-widest text-coop-accent">{eyebrow}</p>
      )}
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white md:text-5xl">{title}</h1>
      {description && (
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-coop-muted">{description}</p>
      )}
    </div>
  );
}
