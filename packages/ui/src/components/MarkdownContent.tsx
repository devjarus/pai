import { useState, useCallback, useRef, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = preRef.current?.textContent ?? "";
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  return (
    <div className="group/code relative my-3">
      <pre
        ref={preRef}
        className="overflow-x-auto rounded-lg border border-border/50 bg-[#0a0a0a] p-4 text-[13px] leading-relaxed"
      >
        {children}
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-2 top-2 rounded-md border border-border/50 bg-background/80 px-2 py-1 text-[10px] font-medium text-muted-foreground opacity-0 transition-all hover:text-foreground group-hover/code:opacity-100"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

const markdownComponents: Components = {
  pre({ children }) {
    return <CodeBlock>{children}</CodeBlock>;
  },
  code({ className, children }) {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return <code className={cn("text-[13px]", className)}>{children}</code>;
    }
    return (
      <code className="rounded-md border border-border/40 bg-muted/50 px-1.5 py-0.5 text-[13px] text-primary/90">
        {children}
      </code>
    );
  },
  p({ children }) {
    return <p className="mb-3 text-sm leading-relaxed text-foreground last:mb-0">{children}</p>;
  },
  h1({ children }) {
    return <h1 className="mb-3 mt-5 text-lg font-bold text-foreground first:mt-0">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="mb-2 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h3>;
  },
  ul({ children }) {
    return <ul className="mb-3 ml-4 list-disc space-y-1 text-sm text-foreground last:mb-0">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="mb-3 ml-4 list-decimal space-y-1 text-sm text-foreground last:mb-0">{children}</ol>;
  },
  li({ children }) {
    return <li className="leading-relaxed">{children}</li>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="mb-3 border-l-2 border-primary/40 pl-4 text-sm italic text-muted-foreground last:mb-0">
        {children}
      </blockquote>
    );
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80">
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="mb-3 overflow-x-auto rounded-lg border border-border/50 last:mb-0">
        <table className="w-full text-sm">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="border-b border-border/50 bg-muted/30">{children}</thead>;
  },
  th({ children }) {
    return <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</th>;
  },
  td({ children }) {
    return <td className="border-t border-border/30 px-3 py-2 text-foreground/85">{children}</td>;
  },
  hr() {
    return <hr className="my-4 border-border/40" />;
  },
  strong({ children }) {
    return <strong className="font-semibold text-foreground">{children}</strong>;
  },
  em({ children }) {
    return <em className="italic text-foreground/80">{children}</em>;
  },
};

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export default function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
