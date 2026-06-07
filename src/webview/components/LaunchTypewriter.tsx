import React from "react";
import { LAUNCH_TYPEWRITER_PHRASE, type LaunchIntroPhase } from "../hooks/useLaunchTypewriter";

type LaunchTypewriterProps = {
  phase: LaunchIntroPhase;
  visibleLength: number;
  flashIndex: number | null;
};

export function LaunchTypewriter({
  phase,
  visibleLength,
  flashIndex
}: LaunchTypewriterProps): React.ReactElement | null {
  if (phase === "done") {
    return null;
  }

  const visible = LAUNCH_TYPEWRITER_PHRASE.slice(0, visibleLength);
  const exiting = phase === "exiting";

  return (
    <div
      className={`coop-launch-typewriter${exiting ? " coop-launch-typewriter--exiting" : ""}`}
      aria-hidden="true"
    >
      <span className="coop-launch-typewriter-text">
        {visible.split("").map((char, index) => (
          <span
            key={`${index}-${char}`}
            className={`coop-launch-typewriter-char${flashIndex === index ? " coop-launch-typewriter-char--flash" : ""}`}
          >
            {char}
          </span>
        ))}
      </span>
      <span className={`coop-launch-typewriter-cursor${phase === "idle" ? "" : ""}`} />
    </div>
  );
}
