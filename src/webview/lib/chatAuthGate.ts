/**
 * Chat homepage is gated only after settings:state arrives with signed-out.
 * `undefined` means we have not heard yet — do not flash a login screen.
 */
export function chatRequiresSignIn(isSignedIn: boolean | undefined): boolean {
  return isSignedIn === false;
}
