import { Component, type ReactNode } from "react";
import { AlertTriangleIcon, RefreshCwIcon, RotateCcwIcon, CopyIcon, CheckIcon } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, copied: false };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  handleTryAgain = () => {
    this.setState({ hasError: false, error: null });
  };

  handleRefresh = () => {
    window.location.reload();
  };

  handleCopy = async () => {
    const { error } = this.state;
    if (!error) return;

    const details = [
      `Error: ${error.message}`,
      `Stack: ${error.stack ?? "N/A"}`,
      `URL: ${window.location.href}`,
      `Time: ${new Date().toISOString()}`,
      `UserAgent: ${navigator.userAgent}`,
    ].join("\n\n");

    try {
      await navigator.clipboard.writeText(details);
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch {
      // Fallback: select-and-copy is not critical
    }
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, copied } = this.state;

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0a0a0a] p-6">
        <div className="flex max-w-md flex-col items-center gap-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangleIcon className="h-8 w-8 text-destructive" />
          </div>

          <div className="space-y-2">
            <h1 className="text-lg font-semibold text-foreground">
              Something went wrong
            </h1>
            <p className="text-sm text-muted-foreground">
              An unexpected error occurred. Try again, refresh the page, or
              copy the error details to report the issue.
            </p>
          </div>

          {error && (
            <div className="w-full rounded-lg border border-border/50 bg-card/30 p-3">
              <p className="break-all font-mono text-xs text-muted-foreground">
                {error.message}
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={this.handleTryAgain}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <RotateCcwIcon className="h-4 w-4" />
              Try Again
            </button>
            <button
              type="button"
              onClick={this.handleRefresh}
              className="inline-flex items-center gap-2 rounded-md border border-border/50 bg-card/50 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card/80"
            >
              <RefreshCwIcon className="h-4 w-4" />
              Refresh Page
            </button>
            <button
              type="button"
              onClick={this.handleCopy}
              className="inline-flex items-center gap-2 rounded-md border border-border/50 bg-card/50 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card/80"
            >
              {copied ? (
                <CheckIcon className="h-4 w-4 text-green-500" />
              ) : (
                <CopyIcon className="h-4 w-4" />
              )}
              {copied ? "Copied" : "Copy error details"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
