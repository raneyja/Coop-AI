import React from "react";
import { SignInForm, type SignInFormProps } from "./SignInForm";

export function ChatSignedOutHome(props: SignInFormProps): React.ReactElement {
  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <div className="flex w-full min-h-full flex-col items-center justify-center px-3 py-5">
        <div className="w-full max-w-[320px]">
          <h2 className="mx-auto max-w-[280px] text-center text-lg font-semibold leading-relaxed tracking-tight text-[var(--coop-panel-foreground)] sm:text-xl">
            CoopAI
          </h2>
          <div className="coop-settings-card mt-5">
            <SignInForm {...props} showStorageNote={false} />
          </div>
        </div>
      </div>
    </div>
  );
}
