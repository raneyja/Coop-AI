import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-zinc-950 text-zinc-100">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link href="/" className="text-sm text-emerald-400 hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
