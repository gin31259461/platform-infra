import { Box, Typography } from "@mui/material";

export function EmptyFleetState() {
  return (
    <Box sx={{ px: 2, py: 4, textAlign: "center" }}>
      <Typography fontSize={14} fontWeight={600}>No runner data</Typography>
      <Typography color="text.secondary" fontSize={13} mt={.75}>
        No Runner Stacks are enrolled in PostgreSQL.
      </Typography>
    </Box>
  );
}
