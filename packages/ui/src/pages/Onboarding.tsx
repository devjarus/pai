import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { remember, createWatchFromTemplateApi } from "../api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SparklesIcon, ArrowRightIcon, BrainIcon, EyeIcon } from "lucide-react";
import LLMSetupWizard from "@/components/LLMSetupWizard";

type OnboardingStep = "welcome" | "llm" | "about" | "watch";

export default function Onboarding() {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [aboutMe, setAboutMe] = useState("");
  const [watchSubject, setWatchSubject] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const finish = () => {
    localStorage.setItem("pai_onboarded", "1");
    navigate("/", { replace: true });
  };

  const handleAboutSubmit = async () => {
    if (!aboutMe.trim()) {
      setStep("watch");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await remember(aboutMe.trim());
      setSaving(false);
      setStep("watch");
    } catch {
      setSaving(false);
      setError("Could not save. You can add this later in your Library.");
    }
  };

  const handleWatchSubmit = async () => {
    if (!watchSubject.trim()) {
      finish();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createWatchFromTemplateApi({
        templateId: "general-watch",
        subject: watchSubject.trim(),
      });
      finish();
    } catch {
      // Best-effort — don't block onboarding if LLM isn't ready yet
      finish();
    }
  };

  // Step 1: Welcome
  if (step === "welcome") {
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
            <p className="text-center text-sm text-muted-foreground">
              Your second brain that watches things for you
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-center text-xs text-muted-foreground leading-relaxed">
              pai remembers what matters to you, researches topics you care about,
              and keeps you updated with personalized digests.
            </p>
            <Button onClick={() => setStep("llm")} className="w-full">
              Get Started <ArrowRightIcon className="ml-2 size-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 2: LLM provider setup
  if (step === "llm") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md border-border/50 bg-card/50">
          <CardHeader className="items-center pb-2">
            <StepIndicator current={2} total={4} />
            <CardTitle className="text-center font-mono text-lg font-semibold">
              Connect your AI
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LLMSetupWizard
              onComplete={() => setStep("about")}
              onSkip={() => setStep("about")}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 3: Tell me about yourself
  if (step === "about") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md border-border/50 bg-card/50">
          <CardHeader className="items-center pb-2">
            <StepIndicator current={3} total={4} />
            <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
              <BrainIcon className="size-6 text-primary" />
            </div>
            <CardTitle className="text-center font-mono text-lg font-semibold">
              Tell me about yourself
            </CardTitle>
            <p className="text-center text-xs text-muted-foreground">
              This helps pai personalize your digests and research.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <textarea
              value={aboutMe}
              onChange={(e) => setAboutMe(e.target.value)}
              placeholder="I'm a software engineer interested in AI, crypto, and travel deals"
              rows={4}
              autoFocus
              className="w-full resize-none rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
            />
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            <Button onClick={handleAboutSubmit} className="w-full" disabled={saving}>
              {saving ? "Saving..." : "Continue"} {!saving && <ArrowRightIcon className="ml-2 size-4" />}
            </Button>
            <button
              type="button"
              onClick={() => setStep("watch")}
              disabled={saving}
              className="w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Skip
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 4: What to watch
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50 bg-card/50">
        <CardHeader className="items-center pb-2">
          <StepIndicator current={4} total={4} />
          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <EyeIcon className="size-6 text-primary" />
          </div>
          <CardTitle className="text-center font-mono text-lg font-semibold">
            What should I watch?
          </CardTitle>
          <p className="text-center text-xs text-muted-foreground">
            pai will research this regularly and send you digests.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            type="text"
            value={watchSubject}
            onChange={(e) => setWatchSubject(e.target.value)}
            placeholder="GPU prices, Bitcoin news, flight deals to Tokyo"
            autoFocus
            className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
          />
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <Button onClick={handleWatchSubmit} className="w-full" disabled={saving}>
            {saving ? "Setting up..." : "Start watching"} {!saving && <ArrowRightIcon className="ml-2 size-4" />}
          </Button>
          <button
            type="button"
            onClick={finish}
            disabled={saving}
            className="w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Skip and go to dashboard
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="mb-2 flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1 rounded-full transition-colors ${
            i + 1 <= current ? "w-6 bg-primary" : "w-4 bg-border"
          }`}
        />
      ))}
    </div>
  );
}
