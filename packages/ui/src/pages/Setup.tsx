import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { setupOwner, remember, updateConfig } from "../api";
import { useAuth } from "../context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SparklesIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import LLMSetupWizard from "../components/LLMSetupWizard";

type Step = "account" | "llm" | "intro";

const STEPS: Step[] = ["account", "llm", "intro"];

function StepIndicator({ current }: { current: Step }) {
  const labels = ["Account", "AI Setup", "About You"];
  const idx = STEPS.indexOf(current);
  return (
    <div className="flex items-center justify-center gap-2 pb-2">
      {labels.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className={`flex size-6 items-center justify-center rounded-full text-[10px] font-medium ${i <= idx ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
            {i + 1}
          </div>
          <span className={`text-[10px] ${i <= idx ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
          {i < labels.length - 1 && <div className={`h-px w-6 ${i < idx ? "bg-primary" : "bg-border"}`} />}
        </div>
      ))}
    </div>
  );
}

export default function Setup() {
  const [step, setStep] = useState<Step>("account");
  const navigate = useNavigate();
  const { refresh, isAuthenticated, needsSetup, loading } = useAuth();

  // Account fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Intro fields
  const [work, setWork] = useState("");
  const [preferences, setPreferences] = useState("");
  const [introSaving, setIntroSaving] = useState(false);
  const [introError, setIntroError] = useState("");

  useEffect(() => {
    if (loading) return;
    if (isAuthenticated && step === "account") {
      setStep("llm");
    } else if (!needsSetup && !isAuthenticated) {
      navigate("/login", { replace: true });
    }
  }, [loading, isAuthenticated, needsSetup, navigate, step]);

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!name.trim() || !email.trim() || !password) {
      setError("Name, email, and password are required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      await setupOwner({ email: email.trim(), password, name: name.trim() });
      localStorage.removeItem("pai_signed_out");
      // Auto-detect and save the user's timezone
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) updateConfig({ timezone: tz }).catch(() => {});
      await refresh();
      setStep("llm");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed.");
      setSaving(false);
    }
  };

  const handleIntroSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIntroSaving(true);
    setIntroError("");
    const promises: Promise<unknown>[] = [];
    if (name.trim()) promises.push(remember(`My name is ${name.trim()}`));
    if (work.trim()) promises.push(remember(`I want pai to keep track of ${work.trim()}`));
    if (preferences.trim()) promises.push(remember(preferences.trim()));
    if (promises.length === 0) {
      localStorage.setItem("pai_onboarded", "1");
      navigate("/ask", { replace: true });
      return;
    }
    try {
      await Promise.all(promises);
      localStorage.setItem("pai_onboarded", "1");
      navigate("/ask", { replace: true });
    } catch {
      setIntroSaving(false);
      setIntroError("Could not save — you can skip and set up later in Settings.");
    }
  };

  const handleSkipIntro = () => {
    localStorage.setItem("pai_onboarded", "1");
    navigate("/ask", { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50 bg-card/50">
        <CardHeader className="items-center pb-2">
          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <SparklesIcon className="size-6 text-primary" />
          </div>
          <CardTitle className="text-center font-mono text-lg font-semibold">
            {step === "account" ? "Set up pai" : step === "llm" ? "Connect your AI" : "Set your first context"}
          </CardTitle>
          <StepIndicator current={step} />
        </CardHeader>
        <CardContent>
          {step === "account" && (
            <form onSubmit={handleAccountSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="What should I call you?" required autoFocus
                  className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required
                  className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
                <div className="relative">
                  <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" required
                    className="w-full rounded-md border border-border/50 bg-background px-3 py-2 pr-9 text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground">
                    {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Confirm Password</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat your password" required
                  className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25" />
              </div>
              {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "Setting up..." : "Create Account"}
              </Button>
            </form>
          )}

          {step === "llm" && (
            <LLMSetupWizard onComplete={() => setStep("intro")} onSkip={() => setStep("intro")} />
          )}

          {step === "intro" && (
            <>
              <p className="mb-4 text-center text-xs text-muted-foreground">
                Tell me what you want me to keep track of so your next brief starts with the right preferences and constraints.
              </p>
              <form onSubmit={handleIntroSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">What decisions or commitments matter most right now?</label>
                  <textarea value={work} onChange={(e) => setWork(e.target.value)} placeholder="e.g. launch readiness, vendor evaluations, travel planning" rows={2} autoFocus
                    className="w-full resize-none rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">What preferences or constraints should I remember?</label>
                  <textarea value={preferences} onChange={(e) => setPreferences(e.target.value)} placeholder="e.g. brief me concisely, cite evidence, prioritize blockers over status theater" rows={2}
                    className="w-full resize-none rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25" />
                </div>
                {introError && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{introError}</p>}
                <Button type="submit" className="w-full" disabled={introSaving}>
                  {introSaving ? "Saving..." : "Open Ask"}
                </Button>
              </form>
              <button type="button" onClick={handleSkipIntro} disabled={introSaving}
                className="mt-3 w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground">
                Skip and open Ask
              </button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
