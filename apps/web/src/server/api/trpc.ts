import { authorize, AuthorizationError } from "@gitlab-runner-platform/domain";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

import type { RequestContext } from "./context";

const t = initTRPC.context<RequestContext>().create({ transformer: superjson });

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

export const viewerProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.actor) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  try {
    authorize(ctx.actor, "fleet:read");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      throw new TRPCError({ code: "FORBIDDEN", cause: error });
    }
    throw error;
  }

  return next({ ctx: { ...ctx, actor: ctx.actor } });
});
