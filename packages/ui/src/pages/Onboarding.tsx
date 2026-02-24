import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { remember } from "../api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SparklesIcon } from "lucide-react";

export default function Onboarding() {
  const [name, setName] = useState("");
  const [work, setWork] = useState("");
  const [preferences, setPreferences] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const promises: Promise<unknown>[] = [];
    if (name.trim()) {
      promises.push(remember(`My name is ${name.trim()}`));
    }
    if (work.trim()) {
      promises.push(remember(`I work on ${work.trim()}`));
    }
    if (preferences.trim()) {
      promises.push(remember(preferences.trim()));
    }

    if (promises.length === 0) {
      localStorage.setItem("pai_onboarded", "1");
      navigate("/chat", { replace: true });
      return;
    }

    try {
      await Promise.all(promises);
      localStorage.setItem("pai_onboarded", "1");
      navigate("/chat", { replace: true });
    } catch {
      setSaving(false);
      setError(
        "Could not save — your LLM provider may not be configured yet. " +
        "You can skip for now and set it up in Settings."
      );
    }
  };

  const handleSkip = () => {
    localStorage.setItem("pai_onboarded", "1");
    navigate("/chat", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50 bg-card/50">
        <CardHeader className="items-center pb-2">
          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <SparklesIcon className="size-6 text-primary" />
          </div>
          <CardTitle className="text-center font-mono text-lg font-semibold">
            Welcome to pai
          </CardTitle>
          <p className="text-center text-xs text-muted-foreground">
            Tell me a bit about yourself so I can be more helpful.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                What should I call you?
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sarah"
                autoFocus
                className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                What do you work on?
              </label>
              <textarea
                value={work}
                onChange={(e) => setWork(e.target.value)}
                placeholder="e.g. Full-stack web apps with React and Python"
                rows={2}
                className="w-full resize-none rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Any preferences I should know?
              </label>
              <textarea
                value={preferences}
                onChange={(e) => setPreferences(e.target.value)}
                placeholder="e.g. I prefer TypeScript, dark mode, and concise answers"
                rows={2}
                className="w-full resize-none rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
              />
            </div>
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? "Saving..." : "Get Started"}
            </Button>
          </form>
          <button
            type="button"
            onClick={handleSkip}
            disabled={saving}
            className="mt-3 w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Skip for now
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
