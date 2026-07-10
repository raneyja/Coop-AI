type UnavailableBannerProps = {
  message?: string;
};

export function UnavailableBanner({
  message = "Could not reach the operator API. Check that the Coop API is running and operator routes are deployed."
}: UnavailableBannerProps) {
  return (
    <div className="border border-coop-border/60 px-4 py-3 text-sm text-coop-muted">
      {message}
    </div>
  );
}
