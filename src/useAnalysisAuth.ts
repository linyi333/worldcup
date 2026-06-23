// Client-side passcode gate for the authorized-only analysis section.
// The passcode is set via the VITE_ANALYSIS_PASSCODE env var (Vercel env).
// Empty = feature disabled entirely. Unlock persists in localStorage.

import { useState, useEffect } from "react";

const STORAGE_KEY = "wc_analysis_unlocked";
const PASSCODE = (import.meta.env.VITE_ANALYSIS_PASSCODE as string | undefined) ?? "";

export function useAnalysisAuth() {
  const required = PASSCODE.length > 0;
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    if (!required) return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === PASSCODE;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!required) return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === PASSCODE && !unlocked) setUnlocked(true);
    if (stored !== PASSCODE && unlocked) setUnlocked(false);
  }, [required, unlocked]);

  function unlock(code: string): boolean {
    if (code.trim() === PASSCODE) {
      try { localStorage.setItem(STORAGE_KEY, PASSCODE); } catch { /* ignore */ }
      setUnlocked(true);
      return true;
    }
    return false;
  }

  function lock() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setUnlocked(false);
  }

  return { required, unlocked, unlock, lock };
}
