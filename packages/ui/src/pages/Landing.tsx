import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  BrainIcon,
  GlobeIcon,
  SearchIcon,
  FlaskConicalIcon,
  ListTodoIcon,
  CodeIcon,
  SmartphoneIcon,
  ShieldCheckIcon,
  GithubIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  CopyIcon,
  CheckIcon,
} from "lucide-react";
import Particles from "@/components/Particles";
import Orb from "@/components/Orb";

const features = [
  {
    icon: BrainIcon,
    title: "Memory that evolves",
    desc: "Beliefs reinforced, contradicted, decayed, and synthesized over time. Ask it something from three months ago — it remembers.",
  },
  {
    icon: GlobeIcon,
    title: "Learns from the web",
    desc: "Point it at any URL and it learns the content. Semantic search and re-ranking, not just keyword matching.",
  },
  {
    icon: SearchIcon,
    title: "Web search with citations",
    desc: "Real-time search powered by SearXNG. Every claim backed by an inline source link. Like Perplexity, but private.",
  },
  {
    icon: FlaskConicalIcon,
    title: "Deep research",
    desc: "Spawns specialized agents — flights, stocks, crypto, news — working in parallel to deliver comprehensive reports.",
  },
  {
    icon: ListTodoIcon,
    title: "Tasks & scheduling",
    desc: "AI-prioritized tasks. Recurring research — daily briefings, weekly summaries — delivered to your inbox automatically.",
  },
  {
    icon: CodeIcon,
    title: "Code execution",
    desc: "Run Python and JavaScript in a sandboxed environment. Data analysis, charts, calculations — right in the conversation.",
  },
  {
    icon: SmartphoneIcon,
    title: "Works everywhere",
    desc: "Web UI, Telegram bot, CLI, or integrate with Claude Code / Cursor / Windsurf via the built-in MCP server.",
  },
];

export default function Landing() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const installCmd = "curl -fsSL https://raw.githubusercontent.com/devjarus/pai/main/install.sh | bash";

  return (
    <div className="min-h-screen overflow-y-auto bg-background font-sans text-foreground">
      {/* Hero — full viewport, only logo + tagline + CTA */}
      <section className="relative flex h-screen flex-col items-center justify-center overflow-hidden">
        <div className="pointer-events-none absolute inset-0 opacity-60">
          <Particles
            particleCount={200}
            particleSpread={14}
            speed={0.1}
            particleColors={["#ffffff"]}
            moveParticlesOnHover={false}
            alphaParticles={false}
            particleBaseSize={100}
            sizeRandomness={3}
            cameraDistance={62}
            disableRotation={false}
          />
        </div>
        <div className="absolute inset-0 opacity-80">
          <Orb hue={25} hoverIntensity={0.13} rotateOnHover forceHoverState={false} />
        </div>

        <div className="relative z-10 mx-auto max-w-2xl px-6 text-center">
          <div className="mb-8 font-mono text-6xl font-bold tracking-tighter text-primary sm:text-8xl">
            pai
          </div>
          <p className="mb-4 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Your Personal AI that actually knows you.
          </p>
          <p className="mx-auto mb-8 max-w-lg text-base leading-relaxed text-foreground/50">
            <span className="text-teal-400">Persistent memory.</span> <span className="text-cyan-400">Web search.</span> <span className="text-teal-400">Deep research.</span><br /><span className="text-cyan-400">Knowledge base.</span> <span className="text-teal-400">Tasks.</span> <span className="text-cyan-400">Code execution.</span><br />Self-hosted. Private. Yours.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button onClick={() => navigate("/login")} className="gap-2">
              Get Started <ArrowRightIcon className="h-4 w-4" />
            </Button>
            <Button variant="outline" asChild>
              <a href="https://github.com/devjarus/pai" target="_blank" rel="noopener noreferrer">
                <GithubIcon className="mr-2 h-4 w-4" /> GitHub
              </a>
            </Button>
          </div>
        </div>

        {/* Scroll hint */}
        <button
          onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })}
          className="absolute bottom-8 z-10 animate-pulse text-muted-foreground/50 transition-colors hover:text-muted-foreground"
          aria-label="Scroll to features"
        >
          <ChevronDownIcon className="h-5 w-5" />
        </button>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-5xl px-6 py-16">
        <p className="mb-2 text-center text-sm font-medium uppercase tracking-widest text-muted-foreground">Features</p>
        <h2 className="mb-3 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          Not another chatbot.
        </h2>
        <p className="mx-auto mb-10 max-w-lg text-center text-base text-muted-foreground">
          A full agent system with persistent memory, knowledge base, and multi-channel access — running on your machine or your cloud.
        </p>

        <div className="flex flex-wrap justify-center gap-4">
          {features.map((f) => (
            <div key={f.title} className="w-72 rounded-lg border border-border p-5 transition-colors hover:bg-muted/50">
              <f.icon className="mb-2 h-5 w-5 text-muted-foreground" />
              <h3 className="mb-1 text-base font-medium">{f.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust */}
      <section className="border-t border-border py-16">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <ShieldCheckIcon className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
          <h2 className="mb-2 text-xl font-semibold tracking-tight sm:text-2xl">Your data stays yours.</h2>
          <p className="mx-auto max-w-md text-base text-muted-foreground">
            Single SQLite file. No cloud dependency. No telemetry. Run it on your laptop, a Raspberry Pi, or Railway. Bring your own LLM — Ollama, OpenAI, Anthropic, or Google.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border py-16">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="mb-4 text-xl font-semibold tracking-tight sm:text-2xl">Get started in 60 seconds.</h2>
          <div className="group relative mb-6 whitespace-nowrap overflow-x-auto rounded-md border border-border bg-muted/30 px-4 py-3">
            <code className="font-mono text-sm text-muted-foreground">{installCmd}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(installCmd); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-border/50 bg-background/80 px-2 py-1 text-[10px] text-muted-foreground opacity-0 transition-all hover:text-foreground group-hover:opacity-100"
            >
              {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="flex items-center justify-center gap-3">
            <Button asChild>
              <a href="https://railway.com/deploy/sFecIN" target="_blank" rel="noopener noreferrer">
                Deploy on Railway
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href="https://github.com/devjarus/pai" target="_blank" rel="noopener noreferrer">
                <GithubIcon className="mr-2 h-4 w-4" /> View on GitHub
              </a>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
