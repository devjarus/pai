import { useState, useEffect } from "react";
import { LightbulbIcon, XIcon } from "lucide-react";

interface Props {
  pageKey: string;
  tip: string;
}

export function FirstVisitBanner({ pageKey, tip }: Props) {
  const storageKey = `pai-fvb-${pageKey}`;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(storageKey)) setVisible(true);
  }, [storageKey]);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(storageKey, "1");
    setVisible(false);
  };

  return (
    <div className="mx-3 mt-2 flex items-center gap-2.5 rounded-md bg-accent/50 px-3 py-2 md:mx-6">
      <LightbulbIcon className="size-3.5 shrink-0 text-primary" />
      <span className="flex-1 text-xs text-muted-foreground">{tip}</span>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 rounded-sm p-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
        aria-label="Dismiss tip"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}
