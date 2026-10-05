const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]';

/** Keep keyboard navigation inside the currently active modal and restore its opener. */
export function containModalFocus(dialog: HTMLElement): () => void {
  const document = dialog.ownerDocument;
  const opener = document.activeElement as HTMLElement | null;
  const ownedPortals = () => dialog.id
    ? Array.from(document.querySelectorAll<HTMLElement>("[data-modal-owner]")).filter(
      (element) => element.getAttribute("data-modal-owner") === dialog.id
    ) : [];
  const controls = () => [dialog, ...ownedPortals()].flatMap(
    (root) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
  ).filter(
    (element) => element.tabIndex >= 0 && !element.hasAttribute("disabled") &&
      !element.closest("[hidden], [inert]") && element.getClientRects().length > 0
  );
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Tab") return;
    const items = controls();
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const active = document.activeElement;
    if (ownedPortals().length > 0) {
      // Portals sit outside the dialog's DOM order. Route every Tab through the
      // owned controls so the browser cannot traverse background elements on
      // the way to or from the menu.
      event.preventDefault();
      const index = items.indexOf(active as HTMLElement);
      const next = index < 0 ? (event.shiftKey ? items.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
      items[next].focus();
      return;
    }
    const inside = dialog.contains(active) || ownedPortals().some((portal) => portal.contains(active));
    if (!inside || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  };
  if (!dialog.contains(document.activeElement)) controls()[0]?.focus();
  document.addEventListener("keydown", handleKeyDown, true);
  return () => {
    document.removeEventListener("keydown", handleKeyDown, true);
    if (opener?.isConnected) opener.focus();
  };
}
