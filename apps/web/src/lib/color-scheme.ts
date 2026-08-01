export const colorSchemeAttribute = "data-mui-color-scheme";
export const colorModeStorageKey = "mui-mode";

export type ColorScheme = "dark" | "light";

export function resolveInitialColorScheme(storedMode: string | null, prefersDark: boolean): ColorScheme {
  if (storedMode === "dark" || storedMode === "light") return storedMode;
  return prefersDark ? "dark" : "light";
}
