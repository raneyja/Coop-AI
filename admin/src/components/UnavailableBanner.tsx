type UnavailableBannerProps = {
  message?: string;
};

export function UnavailableBanner({
  message = "Could not reach this admin API. Check that the Coop API is running and CORS allows this portal origin."
}: UnavailableBannerProps) {
  return (
    <div className="border border-coop-border/60 px-4 py-3 text-sm text-coop-muted">
      {message}
    </div>
  );
}
