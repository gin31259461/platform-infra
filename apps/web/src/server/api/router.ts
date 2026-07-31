import { evaluateRunnerStack, summarizeFleet } from "@gitlab-runner-platform/domain";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure, viewerProcedure } from "./trpc";

export const appRouter = createTRPCRouter({
  health: publicProcedure.query(() => ({ status: "ok" as const })),
  actor: viewerProcedure.query(({ ctx }) => ctx.actor),
  fleet: createTRPCRouter({
    list: viewerProcedure.query(async ({ ctx }) => {
      const snapshot = await ctx.fleetRepository.getSnapshot(ctx.now);
      return {
        generatedAt: snapshot.generatedAt,
        stacks: snapshot.stacks.map((stack) => evaluateRunnerStack(stack, ctx.now)),
        summary: summarizeFleet(snapshot, ctx.now),
      };
    }),
    byId: viewerProcedure.input(z.object({ id: z.string().min(1).max(120) })).query(async ({ ctx, input }) => {
      const snapshot = await ctx.fleetRepository.getSnapshot(ctx.now);
      const stack = snapshot.stacks.find((candidate) => candidate.id === input.id);
      if (!stack) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return evaluateRunnerStack(stack, ctx.now);
    }),
  }),
});

export type AppRouter = typeof appRouter;
