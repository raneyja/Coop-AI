type UnavailableBannerProps = {
  message?: string;
};

export function UnavailableBanner({
  message = "Could not reach this admin API. Check that the Coop API is running and CORS allows this portal origin."
}: UnavailableBannerProps) {
  return (
    <div className="rounded-sm border border-coop-border bg-coop-editor px-4 py-3 text-sm text-coop-muted">
      {message}
    </div>
  );
}
