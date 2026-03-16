import { useState } from "react";
import { testConfig, updateConfig } from "../api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircleIcon, XCircleIcon, LoaderIcon, ExternalLinkIcon, MonitorIcon, CloudIcon } from "lucide-react";

const isCloudDeployment =
  typeof window !== "undefined" &&
  window.location.hostname !== "localhost" &&
  window.location.hostname !== "127.0.0.1";

type ProviderKey = "ollama-local" | "ollama-cloud" | "openai" | "anthropic" | "google" | "cerebras" | "openrouter";

const PROVIDERS: Record<ProviderKey, {
  label: string;
  description: string;
  provider: string;
  baseUrl: string;
  model: string;
  embedModel: string;
  needsKey: boolean;
  keyUrl?: string;
  badge?: string;
}> = {
  "ollama-local": {
    label: "Ollama (local)",
    description: "Free & private — runs on your machine",
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    model: "llama3.2",
    embedModel: "nomic-embed-text",
    needsKey: false,
  },
  "ollama-cloud": {
    label: "Ollama Cloud",
    description: "Free — GLM-5, great at tool calling",
    provider: "openai",
    baseUrl: "https://ollama.com/v1",
    model: "glm-5",
    embedModel: "nomic-embed-text",
    needsKey: true,
    keyUrl: "https://ollama.com",
    badge: "Free",
  },
  openai: {
    label: "OpenAI",
    description: "GPT-4o — fast and reliable",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    embedModel: "text-embedding-3-small",
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
  },
  anthropic: {
    label: "Anthropic",
    description: "Claude Sonnet — strong reasoning",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-20250514",
    embedModel: "text-embedding-3-small",
    needsKey: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  google: {
    label: "Google AI",
    description: "Gemini 2.0 Flash — fast, free tier",
    provider: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.0-flash",
    embedModel: "text-embedding-004",
    needsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
    badge: "Free tier",
  },
  cerebras: {
    label: "Cerebras",
    description: "GPT OSS 120B — reliable Cerebras default",
    provider: "cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    model: "gpt-oss-120b",
    embedModel: "text-embedding-3-small",
    needsKey: true,
    keyUrl: "https://cloud.cerebras.ai/",
  },
  openrouter: {
    label: "OpenRouter",
    description: "300+ models — one key, pay per use",
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4",
    embedModel: "text-embedding-3-small",
    needsKey: true,
    keyUrl: "https://openrouter.ai/keys",
    badge: "Multi-model",
  },
};

type Step = "mode" | "provider" | "apikey" | "local-guide";

interface Props {
  onComplete: () => void;
  onSkip?: () => void;
}

export default function LLMSetupWizard({ onComplete, onSkip }: Props) {
  const [step, setStep] = useState<Step>(isCloudDeployment ? "provider" : "mode");
  const [selected, setSelected] = useState<ProviderKey | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const preset = selected ? PROVIDERS[selected] : null;

  const handleSelectMode = (mode: "local" | "cloud") => {
    if (mode === "local") {
      setSelected("ollama-local");
      setStep("local-guide");
    } else {
      setStep("provider");
    }
  };

  const handleSelectProvider = (key: ProviderKey) => {
    setSelected(key);
    setTestResult(null);
    setApiKey("");
    if (PROVIDERS[key].needsKey) {
      setStep("apikey");
    } else {
      setStep("local-guide");
    }
  };

  const handleTest = async () => {
    if (!preset) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConfig({
        provider: preset.provider,
        model: preset.model,
        baseUrl: preset.baseUrl,
        apiKey: apiKey || undefined,
        embedModel: preset.embedModel,
      });
      setTestResult({ ok: result.ok, error: result.error });
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : "Connection failed" });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!preset) return;
    setSaving(true);
    try {
      await updateConfig({
        provider: preset.provider,
        model: preset.model,
        baseUrl: preset.baseUrl,
        embedModel: preset.embedModel,
        apiKey: apiKey || undefined,
      });
      onComplete();
    } catch {
      setSaving(false);
    }
  };

  // Mode selection: local vs cloud (only shown for local deployments)
  if (step === "mode") {
    return (
      <div className="space-y-3">
        <p className="text-center text-xs text-muted-foreground">How do you want to run your AI?</p>
        <button type="button" onClick={() => handleSelectMode("local")} className="w-full text-left">
          <Card className="cursor-pointer border-border/50 transition-colors hover:border-primary/50">
            <CardContent className="flex items-start gap-3 p-4">
              <MonitorIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Run locally</div>
                <div className="text-xs text-muted-foreground">Free & private. Requires Ollama installed on your machine. Nothing leaves your computer.</div>
              </div>
            </CardContent>
          </Card>
        </button>
        <button type="button" onClick={() => handleSelectMode("cloud")} className="w-full text-left">
          <Card className="cursor-pointer border-border/50 transition-colors hover:border-primary/50">
            <CardContent className="flex items-start gap-3 p-4">
              <CloudIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Use a cloud provider</div>
                <div className="text-xs text-muted-foreground">Faster, smarter models. Requires an API key.</div>
              </div>
            </CardContent>
          </Card>
        </button>
        {onSkip && (
          <button type="button" onClick={onSkip} className="w-full text-center text-xs text-muted-foreground hover:text-foreground">
            Skip — configure later in Settings
          </button>
        )}
      </div>
    );
  }

  // Provider picker (cloud providers)
  if (step === "provider") {
    const cloudProviders: ProviderKey[] = ["ollama-cloud", "openai", "anthropic", "google", "cerebras"];
    return (
      <div className="space-y-3">
        <p className="text-center text-xs text-muted-foreground">Pick your AI provider</p>
        {cloudProviders.map((key) => {
          const p = PROVIDERS[key];
          return (
            <button key={key} type="button" onClick={() => handleSelectProvider(key)} className="w-full text-left">
              <Card className="cursor-pointer border-border/50 transition-colors hover:border-primary/50">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <div className="text-sm font-medium">{p.label}</div>
                    <div className="text-xs text-muted-foreground">{p.description}</div>
                  </div>
                  {p.badge && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{p.badge}</span>
                  )}
                </CardContent>
              </Card>
            </button>
          );
        })}
        {!isCloudDeployment && (
          <button type="button" onClick={() => setStep("mode")} className="w-full text-center text-xs text-muted-foreground hover:text-foreground">
            ← Back
          </button>
        )}
        {onSkip && (
          <button type="button" onClick={onSkip} className="w-full text-center text-xs text-muted-foreground hover:text-foreground">
            Skip — configure later in Settings
          </button>
        )}
      </div>
    );
  }

  // Local Ollama guide
  if (step === "local-guide") {
    return (
      <div className="space-y-4">
        <p className="text-center text-xs text-muted-foreground">Set up Ollama on your machine</p>
        <div className="space-y-2 rounded-md bg-muted/50 p-4 text-xs">
          <p>1. Install Ollama from <a href="https://ollama.com/download" target="_blank" rel="noopener noreferrer" className="text-primary underline">ollama.com/download</a></p>
          <p>2. Open a terminal and run:</p>
          <pre className="rounded bg-background p-2 text-[11px]">ollama pull llama3.2{"\n"}ollama pull nomic-embed-text</pre>
          <p>3. Make sure Ollama is running, then test below.</p>
        </div>
        <Button onClick={handleTest} disabled={testing} className="w-full" variant="outline">
          {testing ? <><LoaderIcon className="mr-2 size-3 animate-spin" /> Testing...</> : "Test Connection"}
        </Button>
        {testResult && (
          <div className={`flex items-center gap-2 rounded-md p-2 text-xs ${testResult.ok ? "bg-green-500/10 text-green-600" : "bg-destructive/10 text-destructive"}`}>
            {testResult.ok ? <CheckCircleIcon className="size-4" /> : <XCircleIcon className="size-4" />}
            {testResult.ok ? "Connected to Ollama!" : (testResult.error ?? "Can't reach Ollama. Is it running?")}
          </div>
        )}
        {testResult?.ok && (
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? "Saving..." : "Continue"}
          </Button>
        )}
        <button type="button" onClick={() => { setStep("mode"); setTestResult(null); }} className="w-full text-center text-xs text-muted-foreground hover:text-foreground">
          ← Back
        </button>
      </div>
    );
  }

  // API key entry + test
  return (
    <div className="space-y-4">
      <p className="text-center text-xs text-muted-foreground">
        Enter your {preset?.label} API key
      </p>
      {preset?.keyUrl && (
        <a href={preset.keyUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1 text-xs text-primary hover:underline">
          Get your key at {new URL(preset.keyUrl).hostname} <ExternalLinkIcon className="size-3" />
        </a>
      )}
      <input
        type="password"
        value={apiKey}
        onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
        placeholder="Paste your API key"
        autoFocus
        className="w-full rounded-md border border-border/50 bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
      />
      <Button onClick={handleTest} disabled={testing || !apiKey.trim()} className="w-full" variant="outline">
        {testing ? <><LoaderIcon className="mr-2 size-3 animate-spin" /> Testing...</> : "Test Connection"}
      </Button>
      {testResult && (
        <div className={`flex items-center gap-2 rounded-md p-2 text-xs ${testResult.ok ? "bg-green-500/10 text-green-600" : "bg-destructive/10 text-destructive"}`}>
          {testResult.ok ? <CheckCircleIcon className="size-4" /> : <XCircleIcon className="size-4" />}
          {testResult.ok ? `Connected to ${preset?.label} successfully!` : (testResult.error ?? "Invalid key. Double-check and try again.")}
        </div>
      )}
      {testResult?.ok && (
        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? "Saving..." : "Continue"}
        </Button>
      )}
      <button type="button" onClick={() => { setStep(isCloudDeployment ? "provider" : "provider"); setTestResult(null); }} className="w-full text-center text-xs text-muted-foreground hover:text-foreground">
        ← Back
      </button>
    </div>
  );
}
