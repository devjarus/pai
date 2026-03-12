import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  BrainIcon,
  FileTextIcon,
  ShieldCheckIcon,
  RadarIcon,
  SmartphoneIcon,
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
    title: "Programs for recurring decisions",
    desc: "Track launch readiness, vendor choices, travel plans, buying decisions, and other questions you need revisited over time.",
  },
  {
    icon: FileTextIcon,
    title: "Briefs that recommend",
    desc: "The main output is a decision-ready brief with a recommendation, what changed, evidence, remembered assumptions, and next actions.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Memory you can work with",
    desc: "Preferences, constraints, and corrections stay durable across sessions so the next brief starts with your actual context instead of a blank slate.",
  },
  {
    icon: RadarIcon,
    title: "Background analysis when it matters",
    desc: "Use lightweight research or deeper analysis behind the same brief workflow. The execution engine stays behind the scenes.",
  },
  {
    icon: SmartphoneIcon,
    title: "Companion surfaces, not clutter",
    desc: "The web app is the control center. Telegram, CLI, and MCP extend delivery and follow-through without becoming separate product stories.",
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
            Keeps track of ongoing decisions and briefs you with your preferences in mind.
          </p>
          <p className="mx-auto mb-5 max-w-xl text-base leading-relaxed text-foreground/60">
            Set a recurring question once. pai remembers what matters, keeps watching in the background,
            and sends recommendation-first briefs when something materially changes.
          </p>
          <div className="mb-8 flex flex-wrap items-center justify-center gap-2">
            {examples.map((example) => (
              <span
                key={example}
                className="rounded-full border border-border/60 bg-background/60 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur"
              >
                {example}
              </span>
            ))}
          </div>
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
        <p className="mb-2 text-center text-sm font-medium uppercase tracking-widest text-muted-foreground">Product Loop</p>
        <h2 className="mb-3 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          One opinionated workflow instead of ten equal surfaces.
        </h2>
        <p className="mx-auto mb-10 max-w-2xl text-center text-base text-muted-foreground">
          Ask, keep watching, get briefed, correct what changed, and let the next brief improve.
          The breadth still exists under the hood, but the product stays centered on Programs, Briefs, Memory, and follow-through.
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
          <h2 className="mb-2 text-xl font-semibold tracking-tight sm:text-2xl">Trust is part of the product.</h2>
          <p className="mx-auto max-w-md text-base text-muted-foreground">
            Self-hosted by default, with local storage and your own model provider. The goal is not just automation, but recurring briefs you can trust enough to correct and use.
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
