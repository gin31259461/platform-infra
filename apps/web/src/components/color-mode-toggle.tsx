"use client";

import { Button } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";

export function ColorModeToggle() {
  const { mode, setMode, systemMode } = useColorScheme();
  const ready = mode !== undefined;
  const currentMode = mode === "system" ? systemMode : mode;
  const nextMode = currentMode === "dark" ? "light" : "dark";

  return (
    <Button
      aria-label={`Switch to ${nextMode} mode`}
      onClick={() => {
        if (ready) setMode(nextMode);
      }}
      size="small"
      sx={{ color: "text.secondary", fontSize: 12, minWidth: 0, px: 1 }}
      variant="text"
    >
      {ready ? (nextMode === "dark" ? "Dark" : "Light") : "Mode"}
    </Button>
  );
}
