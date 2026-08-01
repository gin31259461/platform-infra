import { Button, Container, Paper, Typography } from "@mui/material";
import Link from "next/link";

export default function NotFoundPage() {
  return (
    <Container component="main" maxWidth="sm" sx={{ py: 8 }}>
      <Paper sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 4, textAlign: "center" }} variant="outlined">
        <Typography color="text.secondary" fontSize={12}>404</Typography>
        <Typography component="h1" variant="h4" fontWeight={700} mt={1}>Runner not found</Typography>
        <Typography color="text.secondary" mt={1}>This runner is not in the current data.</Typography>
        <Link href="/runners"><Button sx={{ mt: 3 }} variant="contained">Back to runners</Button></Link>
      </Paper>
    </Container>
  );
}
