import { useState, useCallback } from "react";

const KEY = "pai-new-ui";

export function useNewUI() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(KEY) === "true");
  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(KEY, String(next));
      return next;
    });
  }, []);
  return { newUI: enabled, toggleNewUI: toggle };
}
