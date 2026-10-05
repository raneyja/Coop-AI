import assert from "node:assert/strict";
import { containModalFocus } from "./modalFocus";

let listener: ((event: KeyboardEvent) => void) | undefined;
let portals: Array<{
  getAttribute: (name: string) => string;
  querySelectorAll: () => ReturnType<typeof control>[];
  contains: (node: unknown) => boolean;
}> = [];
const document = {
  activeElement: undefined as unknown,
  querySelectorAll: () => portals,
  addEventListener: (_name: string, handler: typeof listener) => { listener = handler; },
  removeEventListener: (_name: string, handler: typeof listener) => {
    assert.equal(handler, listener);
    listener = undefined;
  }
};
function control(disabled = false, visible = true) {
  return {
    tabIndex: 0, isConnected: true,
    hasAttribute: (name: string) => name === "disabled" && disabled,
    closest: () => null,
    getClientRects: () => visible ? [{}] : [],
    focus() { document.activeElement = this; }
  };
}
const opener = control();
const first = control();
const disabled = control(true);
const hidden = control(false, false);
const last = control();
const nodes = [first, disabled, hidden, last];
const dialog = {
  id: "",
  ownerDocument: document,
  querySelectorAll: () => nodes,
  contains: (node: unknown) => nodes.includes(node as typeof first),
  focus() { document.activeElement = this; }
};
opener.focus();
const cleanup = containModalFocus(dialog as unknown as HTMLElement);
assert.equal(document.activeElement, first, "opening modal moves focus inside");
function sendKey(event: KeyboardEvent) { listener?.(event); }
function tab(shiftKey = false) {
  let prevented = false;
  sendKey({ key: "Tab", shiftKey, preventDefault() { prevented = true; } } as KeyboardEvent);
  return prevented;
}
assert.equal(tab(), false, "middle navigation keeps ordinary browser Tab semantics");
last.focus();
assert.equal(tab(), true);
assert.equal(document.activeElement, first, "last control wraps to first; disabled and hidden excluded");
assert.equal(tab(true), true);
assert.equal(document.activeElement, last, "ShiftTab wraps first to last");
opener.focus();
assert.equal(tab(), true);
assert.equal(document.activeElement, first, "escaped focus returns to modal");
cleanup();
assert.equal(document.activeElement, opener, "closing restores opener");
assert.equal(listener, undefined);

dialog.id = "prompt-dialog";
const edit = control();
const remove = control();
const unrelated = control();
portals = [
  { getAttribute: () => "prompt-dialog", querySelectorAll: () => [edit, remove], contains: (node) => node === edit || node === remove },
  { getAttribute: () => "different-dialog", querySelectorAll: () => [unrelated], contains: (node) => node === unrelated }
];
opener.focus();
const closeWithPortal = containModalFocus(dialog as unknown as HTMLElement);
edit.focus();
assert.equal(tab(), true, "owned portal navigation intercepts background DOM order");
assert.equal(document.activeElement, remove, "Tab from owned Edit reaches Delete");
edit.focus();
assert.equal(tab(true), true);
assert.equal(document.activeElement, last, "ShiftTab from owned Edit returns to dialog, not background");
remove.focus();
assert.equal(tab(), true);
assert.equal(document.activeElement, first, "last owned menu action wraps inside the dialog");
assert.equal(tab(true), true);
assert.equal(document.activeElement, remove, "ShiftTab can reach owned Delete action");
unrelated.focus();
assert.equal(tab(), true);
assert.equal(document.activeElement, first, "unrelated portals cannot bypass containment");
edit.focus();
let escapePrevented = false;
sendKey({ key: "Escape", preventDefault() { escapePrevented = true; } } as KeyboardEvent);
assert.equal(escapePrevented, false, "Escape remains delegated to the active menu's close handler");
closeWithPortal();
console.log("modalFocus: 11/11 assertion groups passed");
