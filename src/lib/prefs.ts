import { useEffect, useState } from "react";

const HIDE_TOOL_CALLS_KEY = "ccch.hideToolCalls";

export function useHideToolCalls(): [boolean, (v: boolean) => void] {
  const [hide, setHide] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(HIDE_TOOL_CALLS_KEY);
      if (raw === null) return true;
      return raw === "true";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(HIDE_TOOL_CALLS_KEY, String(hide));
    } catch {
      // ignore — storage unavailable
    }
  }, [hide]);

  return [hide, setHide];
}
