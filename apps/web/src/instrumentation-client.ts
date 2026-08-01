import {
  colorModeStorageKey,
  colorSchemeAttribute,
  resolveInitialColorScheme,
} from "@/lib/color-scheme";

let storedMode: string | null = null;
try {
  storedMode = localStorage.getItem(colorModeStorageKey);
} catch {
  // Storage can be unavailable in restricted browser contexts.
}

const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
document.documentElement.setAttribute(
  colorSchemeAttribute,
  resolveInitialColorScheme(storedMode, prefersDark),
);
