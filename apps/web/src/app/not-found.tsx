import { Button, Container, Paper, Typography } from "@mui/material";
import Link from "next/link";

export default function NotFoundPage() {
  return (
    <Container component="main" maxWidth="sm" sx={{ py: 8 }}>
      <Paper sx={{ border: "1px solid #d8dee8", borderRadius: 1, p: 4, textAlign: "center" }} variant="outlined">
        <Typography color="text.secondary" fontSize={12}>404</Typography>
        <Typography component="h1" variant="h4" fontWeight={700} mt={1}>Runner Stack not found</Typography>
        <Typography color="text.secondary" mt={1}>The explicit platform identity did not match the current Fleet snapshot.</Typography>
        <Link href="/runners"><Button sx={{ mt: 3 }} variant="contained">Return to inventory</Button></Link>
      </Paper>
    </Container>
  );
}
