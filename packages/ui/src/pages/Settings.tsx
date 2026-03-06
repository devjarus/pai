import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useConfig, useUpdateConfig, useMemoryStats, useBrowseDir, useHealth, useLearningRuns } from "@/hooks";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { InfoBubble } from "../components/InfoBubble";
import { DiagnosticsPanel } from "@/components/settings/DiagnosticsPanel";
import { FolderIcon, FolderOpenIcon, ChevronUpIcon, ChevronDownIcon, BotIcon, CircleCheckIcon, CircleXIcon, LoaderIcon, CpuIcon, LogOutIcon, SunIcon, MoonIcon, MonitorIcon } from "lucide-react";
import type { LearningRun } from "@/api";
import { formatWithTimezone, parseApiDate } from "@/lib/datetime";

const PROVIDER_PRESETS: Record<string, { baseUrl: string; model: string; embedModel: string }> = {
  ollama: { baseUrl: "http://localhost:11434", model: "llama3.2", embedModel: "nomic-embed-text" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o", embedModel: "text-embedding-3-small" },
  anthropic: { baseUrl: "https://api.anthropic.com", model: "claude-sonnet-4-20250514", embedModel: "" },
  google: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-2.0-flash", embedModel: "text-embedding-004" },
};

const DEFAULT_LLM_TRAFFIC = {
  maxConcurrent: 6,
  startGapMs: 1500,
  startupDelayMs: 10000,
  swarmAgentConcurrency: 5,
  reservedInteractiveSlots: 1,
};

export default function Settings() {
  // --- TanStack Query hooks ---
  const { data: config, isLoading: configLoading } = useConfig();
  const { data: stats, isLoading: statsLoading } = useMemoryStats();
  const updateConfigMut = useUpdateConfig();
  const { data: health, isLoading: healthLoading } = useHealth();
  const { data: learningData } = useLearningRuns();
  const { logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const loading = configLoading || statsLoading;

  // Editable fields
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [embedModel, setEmbedModel] = useState("");
  const [embedProvider, setEmbedProvider] = useState("auto");
  const [apiKey, setApiKey] = useState("");
  const [dataDir, setDataDir] = useState("");

  // Telegram settings
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramEnabled, setTelegramEnabled] = useState(false);

  // Timezone
  const [timezone, setTimezone] = useState("");

  // Worker settings
  const [bgLearningEnabled, setBgLearningEnabled] = useState(true);
  const [briefingEnabled, setBriefingEnabled] = useState(true);
  const [knowledgeCleanupEnabled, setKnowledgeCleanupEnabled] = useState(true);
  const [llmTrafficMaxConcurrent, setLlmTrafficMaxConcurrent] = useState(DEFAULT_LLM_TRAFFIC.maxConcurrent);
  const [llmTrafficStartGapMs, setLlmTrafficStartGapMs] = useState(DEFAULT_LLM_TRAFFIC.startGapMs);
  const [llmTrafficStartupDelayMs, setLlmTrafficStartupDelayMs] = useState(DEFAULT_LLM_TRAFFIC.startupDelayMs);
  const [llmTrafficSwarmAgentConcurrency, setLlmTrafficSwarmAgentConcurrency] = useState(DEFAULT_LLM_TRAFFIC.swarmAgentConcurrency);
  const [llmTrafficReservedInteractiveSlots, setLlmTrafficReservedInteractiveSlots] = useState(DEFAULT_LLM_TRAFFIC.reservedInteractiveSlots);

  // Sidecar URLs
  const [sandboxUrl, setSandboxUrl] = useState("");
  const [searchUrl, setSearchUrl] = useState("");
  const [browserUrl, setBrowserUrl] = useState("");

  // Debug settings
  const [debugResearch, setDebugResearch] = useState(false);

  // Learning history
  const [learningHistoryOpen, setLearningHistoryOpen] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);

  // Env overrides (fields controlled by env vars on the server)
  const [envOverrides, setEnvOverrides] = useState<string[]>([]);

  // Directory browser
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState<string | undefined>(undefined);
  const { data: browseResult, isLoading: browseLoading } = useBrowseDir(browsePath, browseOpen);

  useEffect(() => { document.title = "Settings - pai"; }, []);

  // Sync local form state when config loads or changes.
  // Skip sync while editing to avoid resetting unsaved form fields
  // when instant-save toggles (debug, timezone) invalidate the query.
  useEffect(() => {
    if (!config) return;
    // Always sync non-form fields
    setEnvOverrides(config.envOverrides ?? []);
    setDebugResearch(config.debugResearch ?? false);
    setTimezone(config.timezone ?? "");

    // Only sync form fields when not editing
    if (!editing) {
      const llmTraffic = config.workers?.llmTraffic ?? {};
      setProvider(config.llm.provider);
      setModel(config.llm.model);
      setBaseUrl(config.llm.baseUrl ?? "");
      setEmbedModel(config.llm.embedModel ?? "");
      setEmbedProvider(config.llm.embedProvider ?? "auto");
      setDataDir(config.dataDir);
      setTelegramEnabled(config.telegram?.enabled ?? false);
      setBgLearningEnabled(config.workers?.backgroundLearning !== false);
      setBriefingEnabled(config.workers?.briefing !== false);
      setKnowledgeCleanupEnabled(config.workers?.knowledgeCleanup !== false);
      setLlmTrafficMaxConcurrent(llmTraffic.maxConcurrent ?? DEFAULT_LLM_TRAFFIC.maxConcurrent);
      setLlmTrafficStartGapMs(llmTraffic.startGapMs ?? DEFAULT_LLM_TRAFFIC.startGapMs);
      setLlmTrafficStartupDelayMs(llmTraffic.startupDelayMs ?? DEFAULT_LLM_TRAFFIC.startupDelayMs);
      setLlmTrafficSwarmAgentConcurrency(llmTraffic.swarmAgentConcurrency ?? DEFAULT_LLM_TRAFFIC.swarmAgentConcurrency);
      setLlmTrafficReservedInteractiveSlots(llmTraffic.reservedInteractiveSlots ?? DEFAULT_LLM_TRAFFIC.reservedInteractiveSlots);
      setSandboxUrl(config.sandboxUrl ?? "");
      setSearchUrl(config.searchUrl ?? "");
      setBrowserUrl(config.browserUrl ?? "");
    }
  }, [config, editing]);

  const handleSave = useCallback(async () => {
    if (!config) return;
    try {
      const updates: Record<string, string | boolean | number | null> = {};
      if (provider !== config.llm.provider) updates.provider = provider;
      if (model !== config.llm.model) updates.model = model;
      if (baseUrl !== (config.llm.baseUrl ?? "")) updates.baseUrl = baseUrl;
      if (embedModel !== (config.llm.embedModel ?? "")) updates.embedModel = embedModel;
      if (embedProvider !== (config.llm.embedProvider ?? "auto")) updates.embedProvider = embedProvider;
      if (apiKey) updates.apiKey = apiKey;
      if (dataDir !== config.dataDir) updates.dataDir = dataDir;
      if (telegramToken) updates.telegramToken = telegramToken;
      if (telegramEnabled !== (config.telegram?.enabled ?? false)) updates.telegramEnabled = telegramEnabled;
      if (timezone !== (config.timezone ?? "")) updates.timezone = timezone;
      if (bgLearningEnabled !== (config.workers?.backgroundLearning !== false)) updates.backgroundLearning = bgLearningEnabled;
      if (briefingEnabled !== (config.workers?.briefing !== false)) updates.briefingEnabled = briefingEnabled;
      if (knowledgeCleanupEnabled !== (config.workers?.knowledgeCleanup !== false)) updates.knowledgeCleanup = knowledgeCleanupEnabled;
      if (llmTrafficMaxConcurrent !== (config.workers?.llmTraffic?.maxConcurrent ?? DEFAULT_LLM_TRAFFIC.maxConcurrent)) {
        updates.llmTrafficMaxConcurrent = llmTrafficMaxConcurrent;
      }
      if (llmTrafficStartGapMs !== (config.workers?.llmTraffic?.startGapMs ?? DEFAULT_LLM_TRAFFIC.startGapMs)) {
        updates.llmTrafficStartGapMs = llmTrafficStartGapMs;
      }
      if (llmTrafficStartupDelayMs !== (config.workers?.llmTraffic?.startupDelayMs ?? DEFAULT_LLM_TRAFFIC.startupDelayMs)) {
        updates.llmTrafficStartupDelayMs = llmTrafficStartupDelayMs;
      }
      if (llmTrafficSwarmAgentConcurrency !== (config.workers?.llmTraffic?.swarmAgentConcurrency ?? DEFAULT_LLM_TRAFFIC.swarmAgentConcurrency)) {
        updates.llmTrafficSwarmAgentConcurrency = llmTrafficSwarmAgentConcurrency;
      }
      if (llmTrafficReservedInteractiveSlots !== (config.workers?.llmTraffic?.reservedInteractiveSlots ?? DEFAULT_LLM_TRAFFIC.reservedInteractiveSlots)) {
        updates.llmTrafficReservedInteractiveSlots = llmTrafficReservedInteractiveSlots;
      }
      if (sandboxUrl !== (config.sandboxUrl ?? "")) updates.sandboxUrl = sandboxUrl;
      if (searchUrl !== (config.searchUrl ?? "")) updates.searchUrl = searchUrl;
      if (browserUrl !== (config.browserUrl ?? "")) updates.browserUrl = browserUrl;

      if (Object.keys(updates).length === 0) {
        setEditing(false);
        return;
      }

      await updateConfigMut.mutateAsync(updates);
      setApiKey("");
      setTelegramToken("");
      setEditing(false);
      toast.success("Configuration saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save configuration");
    }
  }, [provider, model, baseUrl, embedModel, embedProvider, apiKey, dataDir, timezone, telegramToken, telegramEnabled, bgLearningEnabled, briefingEnabled, knowledgeCleanupEnabled, llmTrafficMaxConcurrent, llmTrafficStartGapMs, llmTrafficStartupDelayMs, llmTrafficSwarmAgentConcurrency, llmTrafficReservedInteractiveSlots, sandboxUrl, searchUrl, browserUrl, config, updateConfigMut]);

  const handleCancel = useCallback(() => {
    if (config) {
      setProvider(config.llm.provider);
      setModel(config.llm.model);
      setBaseUrl(config.llm.baseUrl ?? "");
      setEmbedModel(config.llm.embedModel ?? "");
      setEmbedProvider(config.llm.embedProvider ?? "auto");
      setDataDir(config.dataDir);
    }
    setApiKey("");
    setTimezone(config?.timezone ?? "");
    setTelegramToken("");
    setTelegramEnabled(config?.telegram?.enabled ?? false);
    setBgLearningEnabled(config?.workers?.backgroundLearning !== false);
    setBriefingEnabled(config?.workers?.briefing !== false);
    setKnowledgeCleanupEnabled(config?.workers?.knowledgeCleanup !== false);
    setLlmTrafficMaxConcurrent(config?.workers?.llmTraffic?.maxConcurrent ?? DEFAULT_LLM_TRAFFIC.maxConcurrent);
    setLlmTrafficStartGapMs(config?.workers?.llmTraffic?.startGapMs ?? DEFAULT_LLM_TRAFFIC.startGapMs);
    setLlmTrafficStartupDelayMs(config?.workers?.llmTraffic?.startupDelayMs ?? DEFAULT_LLM_TRAFFIC.startupDelayMs);
    setLlmTrafficSwarmAgentConcurrency(config?.workers?.llmTraffic?.swarmAgentConcurrency ?? DEFAULT_LLM_TRAFFIC.swarmAgentConcurrency);
    setLlmTrafficReservedInteractiveSlots(config?.workers?.llmTraffic?.reservedInteractiveSlots ?? DEFAULT_LLM_TRAFFIC.reservedInteractiveSlots);
    setDebugResearch(config?.debugResearch ?? false);
    setSandboxUrl(config?.sandboxUrl ?? "");
    setSearchUrl(config?.searchUrl ?? "");
    setBrowserUrl(config?.browserUrl ?? "");
    setEditing(false);
  }, [config]);

  const openBrowser = useCallback((startPath?: string) => {
    setBrowsePath(startPath || dataDir || undefined);
    setBrowseOpen(true);
  }, [dataDir]);

  const navigateTo = useCallback((path: string) => {
    setBrowsePath(path);
  }, []);

  const selectDir = useCallback((path: string) => {
    setDataDir(path);
    setBrowseOpen(false);
  }, []);

  const saving = updateConfigMut.isPending;

  if (loading) {
    return (
      <div className="h-full overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-2xl space-y-8">
          <Skeleton className="h-5 w-24" />
          <Card className="gap-0 border-border/50 bg-card/50 py-0">
            <CardHeader className="px-5 py-4">
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardContent className="space-y-0 px-0 py-0">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between border-t border-border/30 px-5 py-3">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ))}
            </CardContent>
          </Card>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="gap-2 border-border/50 bg-card/50 py-4">
                <CardContent className="px-4 py-0">
                  <Skeleton className="mb-2 h-3 w-16" />
                  <Skeleton className="h-7 w-12" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-2xl space-y-8">
        <h1 className="font-mono text-sm font-semibold text-foreground">Settings</h1>

        {/* Configuration */}
        {config ? (
          <Card className="gap-0 overflow-hidden border-border/50 bg-card/50 py-0">
            <CardHeader className="px-5 py-4">
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Configuration
                  <InfoBubble text="LLM provider settings. Edit to change provider, model, or connection details. Changes are saved to ~/.personal-ai/config.json." side="right" />
                </span>
                <div className="flex items-center gap-2">
                  {!editing ? (
                    <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => setEditing(true)}>
                      Edit
                    </Button>
                  ) : (
                    <div className="flex gap-1.5">
                      <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={handleCancel} disabled={saving}>
                        Cancel
                      </Button>
                      <Button size="sm" className="h-6 text-xs" onClick={handleSave} disabled={saving}>
                        {saving ? "Saving..." : "Save"}
                      </Button>
                    </div>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0 px-0 py-0">
              {editing ? (
                <>
                  {/* Provider selector with auto-fill presets */}
                  <div className="flex items-center justify-between gap-4 border-t border-border/30 px-5 py-2.5">
                    <label className="shrink-0 text-xs text-muted-foreground">
                      Provider
                      {envOverrides.includes("provider") && <span className="ml-1 text-[10px] text-amber-400">(set by env)</span>}
                    </label>
                    <select
                      value={provider}
                      onChange={(e) => {
                        const p = e.target.value;
                        setProvider(p);
                        const preset = PROVIDER_PRESETS[p];
                        if (preset) {
                          setBaseUrl(preset.baseUrl);
                          setModel(preset.model);
                          setEmbedModel(preset.embedModel);
                        }
                      }}
                      className="rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-right font-mono text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="ollama">Ollama</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="google">Google AI</option>
                    </select>
                  </div>
                  <EditableRow label="Model" value={model} onChange={setModel} placeholder={PROVIDER_PRESETS[provider]?.model ?? "model name"} envLabel={envOverrides.includes("model")} />
                  <EditableRow label="Base URL" value={baseUrl} onChange={setBaseUrl} placeholder={PROVIDER_PRESETS[provider]?.baseUrl ?? "http://127.0.0.1:11434"} envLabel={envOverrides.includes("baseUrl")} />
                  {/* Embedding provider selector */}
                  <div className="flex items-center justify-between gap-4 border-t border-border/30 px-5 py-2.5">
                    <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      Embed Provider
                      {envOverrides.includes("embedProvider") && <span className="ml-1 text-[10px] text-amber-400">(set by env)</span>}
                      <InfoBubble text="How embeddings are computed for semantic search. Auto tries your LLM provider first, falls back to local. Local uses a built-in model (~23MB download, no API needed)." side="right" />
                    </label>
                    <select
                      value={embedProvider}
                      onChange={(e) => setEmbedProvider(e.target.value)}
                      className="rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-right font-mono text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="auto">Auto (provider → local fallback)</option>
                      <option value="ollama">Ollama</option>
                      <option value="openai">OpenAI</option>
                      <option value="google">Google AI</option>
                      <option value="local">Local (all-MiniLM-L6-v2)</option>
                    </select>
                  </div>
                  {embedProvider !== "local" && (
                    <EditableRow label="Embed Model" value={embedModel} onChange={setEmbedModel} placeholder="e.g. nomic-embed-text" envLabel={envOverrides.includes("embedModel")} />
                  )}
                  <EditableRow label="API Key" value={apiKey} onChange={setApiKey} placeholder={config?.llm.hasApiKey ? "Key saved — enter new to replace" : "Enter API key"} type="password" envLabel={envOverrides.includes("apiKey")} />

                  <Separator className="opacity-30" />

                  {/* Data directory with browse button */}
                  <div className="flex items-center justify-between gap-4 border-t border-border/30 px-5 py-2.5">
                    <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      Data Directory
                      {envOverrides.includes("dataDir") && <span className="ml-1 text-[10px] text-amber-400">(set by env)</span>}
                      <InfoBubble text="Where pai stores its database, logs, and memory. Default: ~/.personal-ai/data/" side="right" />
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={dataDir}
                        onChange={(e) => setDataDir(e.target.value)}
                        placeholder="~/.personal-ai/data"
                        className="w-full max-w-[220px] rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-right font-mono text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 text-xs"
                        onClick={() => openBrowser()}
                      >
                        <FolderOpenIcon className="mr-1 size-3.5" />
                        Browse
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <ConfigRow label="Provider" value={config.llm.provider} />
                  <ConfigRow label="Model" value={config.llm.model} highlight />
                  {config.llm.baseUrl && <ConfigRow label="Base URL" value={config.llm.baseUrl} />}
                  <ConfigRow label="Embed Provider" value={config.llm.embedProvider === "local" ? "Local (all-MiniLM-L6-v2)" : config.llm.embedProvider === "auto" ? "Auto" : config.llm.embedProvider ?? "auto"} />
                  {config.llm.embedProvider !== "local" && config.llm.embedModel && <ConfigRow label="Embed Model" value={config.llm.embedModel} />}

                  <Separator className="opacity-30" />

                  <ConfigRow label="Data Directory" value={config.dataDir} />
                </>
              )}

              {/* Timezone — always editable */}
              <div className="flex items-center justify-between border-t border-border/30 px-5 py-2.5">
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  Timezone
                  <InfoBubble text="Timezone for all date/time display and AI prompts. Auto uses your browser's detected timezone." side="right" />
                </span>
                <select
                  value={timezone}
                  onChange={async (e) => {
                    const val = e.target.value;
                    setTimezone(val);
                    try {
                      await updateConfigMut.mutateAsync({ timezone: val });
                      toast.success("Timezone updated");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed to update timezone");
                    }
                  }}
                  className="rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-right font-mono text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
                >
                  <option value="">Auto ({Intl.DateTimeFormat().resolvedOptions().timeZone})</option>
                  {(Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf("timeZone").map((tz: string) => (
                    <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between border-t border-border/30 px-5 py-3">
                <span className="text-xs text-muted-foreground">Plugins</span>
                <div className="flex gap-1.5">
                  {config.plugins.length > 0 ? (
                    config.plugins.map((p) => (
                      <Badge key={p} variant="secondary" className="text-[10px]">
                        {p}
                      </Badge>
                    ))
                  ) : (
                    <span className="font-mono text-sm text-foreground/70">none</span>
                  )}
                </div>
              </div>

              {/* LLM Connection Status */}
              <div className="flex items-center justify-between border-t border-border/30 px-5 py-3">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  LLM Status
                  <InfoBubble text="Whether pai can reach your LLM provider. If this shows an error, check your provider, base URL, and API key above." side="right" />
                </span>
                <span className="flex items-center gap-2 font-mono text-sm">
                  {healthLoading ? (
                    <>
                      <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
                      <span className="text-muted-foreground">Checking...</span>
                    </>
                  ) : health?.ok ? (
                    <>
                      <CircleCheckIcon className="size-3.5 text-green-500" />
                      <span className="text-green-500">Connected</span>
                    </>
                  ) : (
                    <>
                      <CircleXIcon className="size-3.5 text-red-400" />
                      <span className="text-red-400">Not connected</span>
                    </>
                  )}
                </span>
              </div>

              {/* API Key Warning for cloud providers */}
              {!editing && !config.llm.hasApiKey && config.llm.provider !== "ollama" && (
                <div className="flex items-center gap-2 border-t border-amber-500/20 bg-amber-500/5 px-5 py-2.5">
                  <span className="text-xs text-amber-400">
                    No API key set for {config.llm.provider}. Click Edit above to add your API key.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border/50 bg-card/50 py-4">
            <CardContent className="px-5 py-0 text-sm text-muted-foreground">
              Could not load configuration. Make sure the server is running.
            </CardContent>
          </Card>
        )}

        {/* Appearance */}
        <Card className="gap-0 overflow-hidden border-border/50 bg-card/50 py-0">
          <CardHeader className="px-5 py-4">
            <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Appearance
              <InfoBubble text="Choose between light, dark, or system theme. System theme automatically matches your device's appearance settings." side="right" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-0 px-0 py-0">
            <div className="flex items-center justify-between gap-4 border-t border-border/30 px-5 py-3">
              <label className="text-xs text-muted-foreground">Theme</label>
              <div className="flex gap-1">
                <Button
                  variant={theme === "light" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 gap-1.5 px-2.5 text-xs"
                  onClick={() => setTheme("light")}
                >
                  <SunIcon className="size-3.5" />
                  Light
                </Button>
                <Button
                  variant={theme === "dark" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 gap-1.5 px-2.5 text-xs"
                  onClick={() => setTheme("dark")}
                >
                  <MoonIcon className="size-3.5" />
                  Dark
                </Button>
                <Button
                  variant={theme === "system" ? "default" : "ghost"}
                  size="sm"
                  className="h-7 gap-1.5 px-2.5 text-xs"
                  onClick={() => setTheme("system")}
                >
                  <MonitorIcon className="size-3.5" />
                  System
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Telegram Bot */}
        {config && (
          <Card className="gap-0 overflow-hidden border-border/50 bg-card/50 py-0">
            <CardHeader className="px-5 py-4">
              <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <BotIcon className="size-3.5" />
                Telegram Bot
                <InfoBubble text="Connect a Telegram bot to chat with your AI assistant via Telegram. Get a token from @BotFather, enable the bot, and save. The bot starts automatically." side="right" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0 px-0 py-0">
              {editing ? (
                <>
                  <div className="flex items-center justify-between gap-4 border-t border-border/30 px-5 py-2.5">
                    <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      Enabled
                    </label>
                    <button
                      type="button"
                      onClick={() => setTelegramEnabled(!telegramEnabled)}
                      className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                        telegramEnabled ? "bg-primary" : "bg-muted",
                      )}
                    >
                      <span
                        className={cn(
                          "pointer-events-none block size-4 rounded-full bg-background shadow-lg transition-transform",
                          telegramEnabled ? "translate-x-4" : "translate-x-0",
                        )}
                      />
                    </button>
                  </div>
                  <EditableRow
                    label="Bot Token"
                    value={telegramToken}
                    onChange={setTelegramToken}
                    placeholder={config.telegram?.hasToken ? "Token saved (enter new to replace)" : "Paste token from @BotFather"}
                    type="password"
                  />
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between border-t border-border/30 px-5 py-3">
                    <span className="text-xs text-muted-foreground">Status</span>
                    <span className="flex items-center gap-2 font-mono text-sm">
                      {config.telegram?.running ? (
                        <>
                          <span className="size-2 rounded-full bg-green-500" />
                          <span className="text-green-500">Running</span>
                        </>
                      ) : config.telegram?.error ? (
                        <>
                          <span className="size-2 rounded-full bg-red-500" />
                          <span className="text-red-500">Error</span>
                        </>
                      ) : config.telegram?.enabled ? (
                        <>
                          <span className="size-2 rounded-full bg-yellow-500" />
                          <span className="text-yellow-500">Starting...</span>
                        </>
                      ) : (
                        <span className="text-foreground">Disabled</span>
                      )}
                    </span>
                  </div>
                  {config.telegram?.username && (
                    <ConfigRow label="Bot" value={`@${config.telegram.username}`} highlight />
                  )}
                  {config.telegram?.error && (
                    <div className="flex items-center justify-between border-t border-border/30 px-5 py-3">
                      <span className="text-xs text-muted-foreground">Error</span>
                      <span className="max-w-xs truncate font-mono text-xs text-red-400">{config.telegram.error}</span>
                    </div>
                  )}
                  <ConfigRow
                    label="Bot Token"
                    value={config.telegram?.hasToken ? "Configured" : "Not set"}
                  />
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Background Workers */}
        {config && (
          <Card className="gap-0 overflow-hidden border-border/50 bg-card/50 py-0">
            <CardHeader className="px-5 py-4">
              <CardTitle className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <CpuIcon className="size-3.5" />
                Background Workers
                <InfoBubble text="System jobs that run automatically. Background Learning extracts memories from your conversations every 2 hours. Briefing generates your Inbox summary every 6 hours." side="right" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-0 px-0 py-0">
              {/* Background Learning */}
              <div className="flex items-center justify-between gap-4 border-t border-border/30 px-5 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-foreground">Background Learning</span>
                  <span className="text-[10px] text-muted-foreground">
                    Extracts memories from conversations, reports, and knowledge (every 2h)
                  </span>
                </div>
                {editing ? (
                  <button
                    type="button"
                    onClick={() => setBgLearningEnabled(!bgLearningEnabled)}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                      bgLearningEnabled ? "bg-primary" : "bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none block size-4 rounded-full bg-background shadow-lg transition-transform",
                        bgLearningEnabled ? "translate-x-4" : "translate-x-0",
                      )}
                    />
                  </button>
                ) : (
                  <span className={cn("font-mono text-sm", config.workers?.backgroundLearning !== false ? "text-green-500" : "text-muted-foreground")}>
                    {config.workers?.backgroundLearning !== false ? "On" : "Off"}
                  </span>
                )}
              </div>

              {/* Briefing Generator */}
              <div className="flex items-center justify-between gap-4 border-t border-border/30 px-5 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-foreground">Inbox Briefing</span>
                  <span className="text-[10px] text-muted-foreground">
                    Generates daily summary for your Inbox (every 6h)
                  </span>
                </div>
                {editing ? (
                  <button
                    type="button"
                    onClick={() => setBriefingEnabled(!briefingEnabled)}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                      briefingEnabled ? "bg-primary" : "bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none block size-4 rounded-full bg-background shadow-lg transition-transform",
                        briefingEnabled ? "translate-x-4" : "translate-x-0",
                      )}
                    />
                  </button>
                ) : (
                  <span className={cn("font-mono text-sm", config.workers?.briefing !== false ? "text-green-500" : "text-muted-foreground")}>
                    {config.workers?.briefing !== false ? "On" : "Off"}
                  </span>
                )}
              </div>

              {/* Knowledge Cleanup */}
              <div className="flex items-center justify-between gap-4 border-t border-border/30 px-5 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-foreground">Knowledge Cleanup</span>
                  <span className="text-[10px] text-muted-foreground">
                    Auto-deletes expired knowledge sources (every 24h, default TTL 90 days)
                  </span>
                </div>
                {editing ? (
                  <button
                    type="button"
                    onClick={() => setKnowledgeCleanupEnabled(!knowledgeCleanupEnabled)}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                      knowledgeCleanupEnabled ? "bg-primary" : "bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none block size-4 rounded-full bg-background shadow-lg transition-transform",
                        knowledgeCleanupEnabled ? "translate-x-4" : "translate-x-0",
                      )}
                    />
                  </button>
                ) : (
                  <span className={cn("font-mono text-sm", config.workers?.knowledgeCleanup !== false ? "text-green-500" : "text-muted-foreground")}>
                    {config.workers?.knowledgeCleanup !== false ? "On" : "Off"}
                  </span>
                )}
              </div>

              <div className="border-t border-border/30 px-5 py-3">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  LLM Traffic Shaping
                  <InfoBubble text="Serializes model traffic so chat stays responsive and restart backlogs do not stampede the LLM server. Background jobs wait behind interactive work." side="right" />
                </div>
              </div>

              {editing ? (
                <>
                  <NumericWorkerRow
                    label="Max LLM concurrency"
                    value={llmTrafficMaxConcurrent}
                    onChange={setLlmTrafficMaxConcurrent}
                    min={1}
                    description="Concurrent LLM or embed requests allowed for this instance."
                  />
                  <NumericWorkerRow
                    label="Background start gap"
                    value={llmTrafficStartGapMs}
                    onChange={setLlmTrafficStartGapMs}
                    min={0}
                    step={100}
                    suffix="ms"
                    description="Delay between starting background requests so the provider sees smoother traffic."
                  />
                  <NumericWorkerRow
                    label="Startup delay"
                    value={llmTrafficStartupDelayMs}
                    onChange={setLlmTrafficStartupDelayMs}
                    min={0}
                    step={1000}
                    suffix="ms"
                    description="How long workers wait after boot before draining queued background jobs."
                  />
                  <NumericWorkerRow
                    label="Swarm agent concurrency"
                    value={llmTrafficSwarmAgentConcurrency}
                    onChange={setLlmTrafficSwarmAgentConcurrency}
                    min={1}
                    description="How many swarm sub-agents may run at once inside a single background job."
                  />
                  <NumericWorkerRow
                    label="Reserved interactive slots"
                    value={llmTrafficReservedInteractiveSlots}
                    onChange={setLlmTrafficReservedInteractiveSlots}
                    min={0}
                    description="Capacity held back from background work so chats and deferred tasks can still start immediately."
                  />
                </>
              ) : (
                <>
                  <ConfigRow label="Max LLM concurrency" value={String(config.workers?.llmTraffic?.maxConcurrent ?? DEFAULT_LLM_TRAFFIC.maxConcurrent)} />
                  <ConfigRow label="Background start gap" value={`${config.workers?.llmTraffic?.startGapMs ?? DEFAULT_LLM_TRAFFIC.startGapMs}ms`} />
                  <ConfigRow label="Startup delay" value={`${config.workers?.llmTraffic?.startupDelayMs ?? DEFAULT_LLM_TRAFFIC.startupDelayMs}ms`} />
                  <ConfigRow label="Swarm agent concurrency" value={String(config.workers?.llmTraffic?.swarmAgentConcurrency ?? DEFAULT_LLM_TRAFFIC.swarmAgentConcurrency)} />
                  <ConfigRow label="Reserved interactive slots" value={String(config.workers?.llmTraffic?.reservedInteractiveSlots ?? DEFAULT_LLM_TRAFFIC.reservedInteractiveSlots)} />
                </>
              )}

              {/* Last Run Info */}
              {config.workers?.lastRun && (
                <div className="flex items-center justify-between border-t border-border/30 px-5 py-3">
                  <span className="text-xs text-muted-foreground">Last learning run</span>
                  <span className="font-mono text-xs text-foreground/70">
                    {config.workers.lastRun.threads
                      ? formatWithTimezone(parseApiDate(config.workers.lastRun.threads), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }, timezone || undefined)
                      : "Never"}
                  </span>
                </div>
              )}

              {/* Learning History (collapsible) */}
              {learningData && learningData.runs.length > 0 && (
                <div className="border-t border-border/30">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-5 py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setLearningHistoryOpen(!learningHistoryOpen)}
                  >
                    <span>View history ({learningData.runs.length} runs)</span>
                    {learningHistoryOpen ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
                  </button>
                  {learningHistoryOpen && (
                    <div className="space-y-2 px-5 pb-4">
                      {learningData.runs.slice(0, 10).map((run) => (
                        <LearningRunCard
                          key={run.id}
                          run={run}
                          expanded={expandedRunId === run.id}
                          onToggle={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Sidecar URLs */}
              {editing && (
                <>
                  <div className="border-t border-border/30 px-5 py-3 space-y-3">
                    <div className="space-y-1">
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        Sandbox URL
                        <InfoBubble text="URL for the code execution sandbox (e.g. http://localhost:8888). Auto-detected in Docker/Railway if left empty." side="right" />
                      </label>
                      <input
                        type="text"
                        value={sandboxUrl}
                        onChange={(e) => setSandboxUrl(e.target.value)}
                        placeholder="Auto-detect"
                        className="w-full rounded-md border border-border/50 bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        Search URL
                        <InfoBubble text="URL for the SearXNG search engine (e.g. http://localhost:8080). Auto-detected in Docker/Railway if left empty." side="right" />
                      </label>
                      <input
                        type="text"
                        value={searchUrl}
                        onChange={(e) => setSearchUrl(e.target.value)}
                        placeholder="Auto-detect"
                        className="w-full rounded-md border border-border/50 bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        Browser URL
                        <InfoBubble text="URL for the Pinchtab browser automation service (e.g. http://localhost:9867). Auto-detected in Docker/Railway if left empty. Enables browse_* tools for JS-rendered pages." side="right" />
                      </label>
                      <input
                        type="text"
                        value={browserUrl}
                        onChange={(e) => setBrowserUrl(e.target.value)}
                        placeholder="Auto-detect"
                        className="w-full rounded-md border border-border/50 bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                    </div>
                  </div>
                </>
              )}
              {!editing && (sandboxUrl || searchUrl || browserUrl) && (
                <div className="border-t border-border/30 px-5 py-3 space-y-1.5">
                  {sandboxUrl && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Sandbox URL</span>
                      <span className="font-mono text-foreground/80">{sandboxUrl}</span>
                    </div>
                  )}
                  {searchUrl && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Search URL</span>
                      <span className="font-mono text-foreground/80">{searchUrl}</span>
                    </div>
                  )}
                  {browserUrl && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Browser URL</span>
                      <span className="font-mono text-foreground/80">{browserUrl}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Debug Research */}
              <div className="flex items-center justify-between gap-4 border-t border-border/30 px-5 py-3">
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1 text-xs text-foreground">
                    Debug Research
                    <InfoBubble text="Show debug information (render spec, raw data) on research results in Inbox and Jobs pages. Useful for troubleshooting result rendering." side="right" />
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Show debug info on research results
                  </span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const next = !debugResearch;
                    setDebugResearch(next);
                    try {
                      await updateConfigMut.mutateAsync({ debugResearch: next });
                      toast.success(`Debug research ${next ? "enabled" : "disabled"}`);
                    } catch (err) {
                      setDebugResearch(!next);
                      toast.error(err instanceof Error ? err.message : "Failed to update setting");
                    }
                  }}
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                    debugResearch ? "bg-primary" : "bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none block size-4 rounded-full bg-background shadow-lg transition-transform",
                      debugResearch ? "translate-x-4" : "translate-x-0",
                    )}
                  />
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        <DiagnosticsPanel timezone={timezone || undefined} />

        {/* Memory Health */}
        {stats ? (
          <div className="space-y-4">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Memory Health
              <InfoBubble text="Overview of pai's belief system. Active beliefs are used for recall, forgotten beliefs are soft-deleted, invalidated beliefs were contradicted by newer evidence." />
            </h2>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Total Beliefs" value={stats.beliefs.total} />
              <StatCard label="Active" value={stats.beliefs.active} accent />
              <StatCard label="Forgotten" value={stats.beliefs.forgotten} />
              <StatCard label="Invalidated" value={stats.beliefs.invalidated} />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard
                label="Avg Confidence"
                value={`${Math.round(stats.avgConfidence * 100)}%`}
              />
              <StatCard label="Total Episodes" value={stats.episodes} />
              {stats.newestBelief && (
                <StatCard
                  label="Latest Update"
                  value={formatWithTimezone(parseApiDate(stats.newestBelief), { month: "short", day: "numeric" }, timezone || undefined)}
                />
              )}
            </div>
          </div>
        ) : (
          <Card className="border-border/50 bg-card/50 py-4">
            <CardContent className="px-5 py-0 text-sm text-muted-foreground">
              Could not load memory stats. Make sure the server is running.
            </CardContent>
          </Card>
        )}
      </div>

      {/* Sign Out */}
      <Separator className="my-2" />
      <Button
        variant="ghost"
        className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-destructive"
        onClick={async () => {
          await logout();
          navigate("/login", { replace: true });
        }}
      >
        <LogOutIcon className="size-3.5" />
        Sign out
      </Button>

      {/* Directory browser dialog */}
      <Dialog open={browseOpen} onOpenChange={setBrowseOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Choose Data Directory</DialogTitle>
          </DialogHeader>

          {browseResult && (
            <div className="space-y-3">
              {/* Current path */}
              <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2">
                <span className="font-mono text-xs text-muted-foreground">{browseResult.current}</span>
              </div>

              {/* Up button */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-start gap-2 text-xs text-muted-foreground"
                onClick={() => navigateTo(browseResult.parent)}
                disabled={browseLoading}
              >
                <ChevronUpIcon className="size-3.5" />
                Parent directory
              </Button>

              {/* Directory list */}
              <ScrollArea className="h-64 rounded-md border border-border/50">
                {browseLoading ? (
                  <div className="space-y-2 p-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-7 w-full" />
                    ))}
                  </div>
                ) : browseResult.entries.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">No subdirectories</p>
                ) : (
                  <div className="p-1">
                    {browseResult.entries.map((entry) => (
                      <button
                        key={entry.path}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-accent/50"
                        onDoubleClick={() => navigateTo(entry.path)}
                        onClick={() => setDataDir(entry.path)}
                      >
                        <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{entry.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </ScrollArea>

              {/* Actions */}
              <div className="flex items-center justify-between">
                <span className="truncate font-mono text-[10px] text-muted-foreground">
                  Selected: {dataDir}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => selectDir(browseResult.current)}
                  >
                    Use current
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setBrowseOpen(false)}
                  >
                    Done
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConfigRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between border-t border-border/30 px-5 py-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-sm", highlight ? "text-primary font-medium" : "text-foreground")}>
        {value}
      </span>
    </div>
  );
}

function EditableRow({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  envLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  envLabel?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/30 px-5 py-2.5">
      <label className="shrink-0 text-xs text-muted-foreground">
        {label}
        {envLabel && <span className="ml-1 text-[10px] text-amber-400">(set by env)</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full max-w-xs rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-right font-mono text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
      />
    </div>
  );
}

function NumericWorkerRow({
  label,
  value,
  onChange,
  description,
  min = 0,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  description: string;
  min?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/30 px-5 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground">{description}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          step={step}
          value={value}
          onChange={(event) => onChange(Math.max(min, Number(event.target.value) || min))}
          className="w-24 rounded-md border border-border/50 bg-background px-2.5 py-1.5 text-right font-mono text-sm text-foreground outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
        />
        {suffix ? <span className="text-xs text-muted-foreground">{suffix}</span> : null}
      </div>
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - parseApiDate(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function LearningRunCard({
  run,
  expanded,
  onToggle,
}: {
  run: LearningRun;
  expanded: boolean;
  onToggle: () => void;
}) {
  const statusColor: Record<string, string> = {
    done: "bg-green-500/15 text-green-500",
    skipped: "bg-yellow-500/15 text-yellow-500",
    error: "bg-red-500/15 text-red-400",
    running: "bg-blue-500/15 text-blue-400",
  };

  const signalParts: string[] = [];
  if (run.threadsCount > 0) signalParts.push(`${run.threadsCount} thread${run.threadsCount !== 1 ? "s" : ""}`);
  if (run.messagesCount > 0) signalParts.push(`${run.messagesCount} msg${run.messagesCount !== 1 ? "s" : ""}`);
  if (run.researchCount > 0) signalParts.push(`${run.researchCount} research`);
  if (run.tasksCount > 0) signalParts.push(`${run.tasksCount} task${run.tasksCount !== 1 ? "s" : ""}`);
  if (run.knowledgeCount > 0) signalParts.push(`${run.knowledgeCount} knowledge`);

  const outcomeParts: string[] = [];
  if (run.beliefsCreated > 0) outcomeParts.push(`${run.beliefsCreated} created`);
  if (run.beliefsReinforced > 0) outcomeParts.push(`${run.beliefsReinforced} reinforced`);
  if (run.lowImportanceSkipped > 0) outcomeParts.push(`${run.lowImportanceSkipped} skipped`);

  let facts: Array<{ fact: string; factType: string; importance: number }> = [];
  if (run.factsJson) {
    try { facts = JSON.parse(run.factsJson); } catch { /* ignore */ }
  }

  return (
    <div className="rounded-md border border-border/30 bg-muted/20">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={onToggle}
      >
        <Badge variant="secondary" className={cn("shrink-0 text-[10px]", statusColor[run.status])}>
          {run.status}
        </Badge>
        <span className="flex-1 truncate text-[11px] text-muted-foreground">
          {signalParts.length > 0 ? signalParts.join(", ") : run.skipReason ?? "no signals"}
        </span>
        {run.durationMs != null && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {run.durationMs < 1000 ? `${run.durationMs}ms` : `${(run.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(run.startedAt)}</span>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border/20 px-3 py-2">
          {outcomeParts.length > 0 && (
            <div className="text-[11px] text-foreground/70">
              Beliefs: {outcomeParts.join(", ")}
            </div>
          )}
          {run.error && (
            <div className="text-[11px] text-red-400">
              Error: {run.error}
            </div>
          )}
          {facts.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Extracted facts ({facts.length})
              </div>
              {facts.map((f, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px] text-foreground/70">
                  <Badge variant="outline" className="shrink-0 text-[9px]">{f.factType}</Badge>
                  <span>{f.fact}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">imp:{f.importance}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <Card className="gap-2 border-border/50 bg-card/50 py-4">
      <CardContent className="px-4 py-0">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div
          className={cn("font-mono text-lg", accent ? "text-primary" : "text-foreground")}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
