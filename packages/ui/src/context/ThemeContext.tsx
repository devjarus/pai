import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeState>({
  theme: "system",
  setTheme: () => {},
});

const STORAGE_KEY = "pai-theme";

function getSystemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const effectiveTheme = theme === "system" ? getSystemTheme() : theme;
  
  if (effectiveTheme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  
  // Update theme-color meta tag
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    const bgColor = effectiveTheme === "dark" ? "#0a0a0a" : "#ffffff";
    metaThemeColor.setAttribute("content", bgColor);
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return (stored === "light" || stored === "dark" || stored === "system") ? stored : "system";
  });

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}

export function getEffectiveTheme(theme: Theme): "light" | "dark" {
  return theme === "system" ? getSystemTheme() : theme;
}
