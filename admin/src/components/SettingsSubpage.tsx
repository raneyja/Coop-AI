import Link from "next/link";

export function SettingsSubpage({
  title,
  description,
  children,
  wide = false
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "space-y-8" : "max-w-2xl space-y-8"}>
      <div>
        <Link href="/settings" className="admin-link text-sm">
          ← Settings
        </Link>
        <h1 className="admin-page-title mt-3">{title}</h1>
        {description ? <p className="mt-1 text-sm text-coop-muted">{description}</p> : null}
      </div>
      {children}
    </div>
  );
}
