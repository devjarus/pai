import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { setAuthToken, verifyToken } from "../api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LockKeyholeIcon } from "lucide-react";

export default function Login() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    setChecking(true);
    setError("");

    const valid = await verifyToken(token.trim());
    if (valid) {
      setAuthToken(token.trim());
      navigate("/chat", { replace: true });
    } else {
      setError("Invalid access token. Please try again.");
    }
    setChecking(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm border-border/50 bg-card/50">
        <CardHeader className="items-center pb-2">
          <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <LockKeyholeIcon className="size-6 text-primary" />
          </div>
          <CardTitle className="text-center font-mono text-lg font-semibold">
            pai
          </CardTitle>
          <p className="text-center text-xs text-muted-foreground">
            Enter your access token to continue
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Access token"
                autoFocus
                className="w-full rounded-md border border-border/50 bg-background px-3 py-2 font-mono text-sm text-foreground placeholder-muted-foreground/50 outline-none transition-colors focus:border-primary/50 focus:ring-1 focus:ring-primary/25"
              />
              {error && (
                <p className="mt-2 text-xs text-red-400">{error}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={checking || !token.trim()}>
              {checking ? "Verifying..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
