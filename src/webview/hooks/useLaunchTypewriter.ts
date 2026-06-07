import { useCallback, useEffect, useRef, useState } from "react";

export const LAUNCH_TYPEWRITER_PHRASE = "ask coop";

const LETTER_DELAYS_MS = [200, 180, 240, 300, 190, 210, 200];
const CURSOR_LEAD_MS = 450;
const HOLD_AFTER_MS = 450;
const EXIT_MS = 300;

export type LaunchIntroPhase = "idle" | "cursor" | "typing" | "hold" | "exiting" | "done";

type LaunchTypewriterState = {
  phase: LaunchIntroPhase;
  visibleLength: number;
  flashIndex: number | null;
  showSyncWhisper: boolean;
  skip: () => void;
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useLaunchTypewriter(enabled: boolean, onComplete?: () => void): LaunchTypewriterState {
  const [phase, setPhase] = useState<LaunchIntroPhase>("done");
  const [visibleLength, setVisibleLength] = useState(0);
  const [flashIndex, setFlashIndex] = useState<number | null>(null);
  const [showSyncWhisper, setShowSyncWhisper] = useState(false);
  const runIdRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
  }, []);

  const finish = useCallback(
    (notify = false) => {
      clearTimers();
      setShowSyncWhisper(false);
      setFlashIndex(null);
      setVisibleLength(LAUNCH_TYPEWRITER_PHRASE.length);
      setPhase("done");
      if (notify) {
        onComplete?.();
      }
    },
    [clearTimers, onComplete]
  );

  const skip = useCallback(() => {
    runIdRef.current += 1;
    finish(true);
  }, [finish]);

  useEffect(() => {
    runIdRef.current += 1;
    const runId = runIdRef.current;
    clearTimers();

    if (!enabled) {
      setPhase("done");
      setVisibleLength(LAUNCH_TYPEWRITER_PHRASE.length);
      setFlashIndex(null);
      setShowSyncWhisper(false);
      return;
    }

    setPhase("cursor");
    setVisibleLength(0);
    setFlashIndex(null);
    setShowSyncWhisper(false);

    if (prefersReducedMotion()) {
      setVisibleLength(LAUNCH_TYPEWRITER_PHRASE.length);
      setPhase("done");
      onComplete?.();
      return;
    }

    schedule(() => {
      if (runId !== runIdRef.current) {
        return;
      }
      setPhase("typing");
      setShowSyncWhisper(true);
    }, CURSOR_LEAD_MS);

    let elapsed = CURSOR_LEAD_MS;
    LAUNCH_TYPEWRITER_PHRASE.split("").forEach((_, index) => {
      schedule(() => {
        if (runId !== runIdRef.current) {
          return;
        }
        setVisibleLength(index + 1);
        setFlashIndex(index);
        schedule(() => {
          if (runId !== runIdRef.current) {
            return;
          }
          setFlashIndex((current) => (current === index ? null : current));
        }, 140);
      }, elapsed);
      elapsed += LETTER_DELAYS_MS[index] ?? 200;
    });

    schedule(() => {
      if (runId !== runIdRef.current) {
        return;
      }
      setPhase("hold");
    }, elapsed);

    schedule(() => {
      if (runId !== runIdRef.current) {
        return;
      }
      setPhase("exiting");
      setShowSyncWhisper(false);
    }, elapsed + HOLD_AFTER_MS);

    schedule(() => {
      if (runId !== runIdRef.current) {
        return;
      }
      finish(true);
    }, elapsed + HOLD_AFTER_MS + EXIT_MS);

    return () => {
      runIdRef.current += 1;
      clearTimers();
    };
  }, [clearTimers, enabled, finish, onComplete, schedule]);

  return {
    phase,
    visibleLength,
    flashIndex,
    showSyncWhisper,
    skip
  };
}
