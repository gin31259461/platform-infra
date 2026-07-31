import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { createRequestContext } from "@/server/api/context";
import { appRouter } from "@/server/api/router";

const handler = (request: Request) => fetchRequestHandler({
  endpoint: "/api/trpc",
  req: request,
  router: appRouter,
  createContext: () => createRequestContext(),
});

export { handler as GET, handler as POST };
