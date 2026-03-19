import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  GithubIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  CopyIcon,
  CheckIcon,
  ShieldCheckIcon,
} from "lucide-react";
import Particles from "@/components/Particles";
import Orb from "@/components/Orb";
import { PaiLogo } from "@/components/PaiLogo";

const features = [
  {
    num: "01",
    title: "Programs for recurring decisions",
    desc: "Track launch readiness, vendor choices, travel plans, buying decisions, and other questions you need revisited over time.",
  },
  {
    num: "02",
    title: "Briefs that recommend",
    desc: "The main output is a decision-ready brief with a recommendation, what changed, evidence, remembered assumptions, and next actions.",
  },
  {
    num: "03",
    title: "Memory you can work with",
    desc: "Preferences, constraints, and corrections stay durable across sessions so the next brief starts with your actual context instead of a blank slate.",
  },
  {
    num: "04",
    title: "Background analysis when it matters",
    desc: "Use lightweight research or deeper analysis behind the same brief workflow. The execution engine stays behind the scenes.",
  },
  {
    num: "05",
    title: "Companion surfaces, not clutter",
    desc: "The web app is the control center. Telegram, CLI, and MCP extend delivery and saved moves without becoming separate product stories.",
  },
];

const examples = [
  "Launch readiness",
  "Vendor evaluation",
  "Japan trip planning",
  "Used EV search",
];

export default function Landing() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const installCmd = "curl -fsSL https://raw.githubusercontent.com/devjarus/pai/main/install.sh | bash";

  return (
    <div className="min-h-screen overflow-y-auto bg-background font-sans text-foreground">
      {/* Hero — asymmetric, left-aligned */}
      <section className="relative flex h-screen flex-col justify-center overflow-hidden">
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

        <div className="relative z-10 mx-auto w-full max-w-5xl px-8 sm:px-12">
          <div className="max-w-2xl">
            <div className="mb-6 flex items-center gap-4 text-primary">
              <PaiLogo size={72} className="hidden sm:block" />
              <PaiLogo size={48} className="sm:hidden" />
              <span className="font-display text-7xl italic sm:text-9xl">pai</span>
            </div>
            <h1 className="mb-5 text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
              Keeps track of ongoing decisions and briefs you with your preferences in mind.
            </h1>
            <p className="mb-6 max-w-lg text-base leading-relaxed text-foreground/60">
              Set a recurring question once. pai remembers what matters, keeps watching in the background,
              and sends recommendation-first briefs when something materially changes.
            </p>
            <div className="mb-8 flex flex-wrap items-center gap-2">
              {examples.map((example) => (
                <span
                  key={example}
                  className="rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur"
                >
                  {example}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-3">
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
        </div>

        {/* Scroll hint */}
        <button
          onClick={() => document.getElementById("features")?.scrollIntoView({ behavior: "smooth" })}
          className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 motion-safe:animate-pulse text-muted-foreground/50 transition-colors hover:text-muted-foreground"
          aria-label="Scroll to features"
        >
          <ChevronDownIcon className="h-5 w-5" />
        </button>
      </section>

      {/* Features — editorial numbered list, no cards */}
      <section id="features" className="mx-auto max-w-5xl px-8 py-20 sm:px-12">
        <div className="mb-16 max-w-xl">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">Product Loop</p>
          <h2 className="text-2xl font-semibold leading-snug tracking-tight text-foreground sm:text-3xl">
            One opinionated workflow instead of ten equal surfaces.
          </h2>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-muted-foreground">
            Ask, keep watching, get briefed, correct what changed, and let the next brief improve.
          </p>
        </div>

        <div className="space-y-0">
          {features.map((f) => (
            <div key={f.num} className="group grid grid-cols-[auto_1fr] gap-x-6 border-t border-border/40 py-6 sm:grid-cols-[3rem_1fr_1fr] sm:gap-x-10 sm:py-8">
              <span className="font-mono text-xs text-muted-foreground/50 pt-1">{f.num}</span>
              <h3 className="text-base font-medium text-foreground sm:text-lg">{f.title}</h3>
              <p className="col-start-2 mt-1 text-sm leading-relaxed text-muted-foreground sm:col-start-3 sm:mt-0">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust — left-aligned */}
      <section className="border-t border-border/40 py-20">
        <div className="mx-auto max-w-5xl px-8 sm:px-12">
          <div className="flex items-start gap-4 max-w-xl">
            <ShieldCheckIcon className="mt-1 h-6 w-6 shrink-0 text-muted-foreground" />
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Trust is part of the product.</h2>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                Self-hosted by default, with local storage and your own model provider. The goal is not just automation, but recurring briefs you can trust enough to correct and use.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/40 py-20">
        <div className="mx-auto max-w-5xl px-8 sm:px-12">
          <div className="max-w-xl">
            <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Get started in 60 seconds.</h2>
            <div className="group relative mt-6 mb-6 whitespace-nowrap overflow-x-auto rounded-md border border-border bg-muted/30 px-4 py-3">
              <code className="font-mono text-sm text-muted-foreground">{installCmd}</code>
              <button
                onClick={() => { navigator.clipboard.writeText(installCmd); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-border/50 bg-background/80 px-2 py-1 text-[10px] text-muted-foreground opacity-0 transition-all hover:text-foreground group-hover:opacity-100"
              >
                {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
              </button>
            </div>
            <div className="flex items-center gap-3">
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
        </div>
      </section>
    </div>
  );
}
