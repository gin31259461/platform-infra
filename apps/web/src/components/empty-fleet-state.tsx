import { Box, Typography } from "@mui/material";

export function EmptyFleetState() {
  return (
    <Box sx={{ px: 2, py: 4, textAlign: "center" }}>
      <Typography color="text.secondary" fontSize={13}>No runners found.</Typography>
    </Box>
  );
}
