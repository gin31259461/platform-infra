import { evaluateRunnerStack, summarizeFleet } from "@gitlab-runner-platform/domain";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure, viewerProcedure } from "./trpc";

export const appRouter = createTRPCRouter({
  health: publicProcedure.query(() => ({ status: "ok" as const })),
  fleet: createTRPCRouter({
    list: viewerProcedure.query(async ({ ctx }) => {
      const snapshot = await ctx.fleetRepository.getSnapshot(ctx.now);
      return {
        generatedAt: snapshot.generatedAt,
        stacks: snapshot.stacks.map((stack) => evaluateRunnerStack(stack, ctx.now, ctx.freshnessPolicy)),
        summary: summarizeFleet(snapshot, ctx.now, ctx.freshnessPolicy),
      };
    }),
    byId: viewerProcedure.input(z.object({ id: z.string().min(1).max(120) })).query(async ({ ctx, input }) => {
      const snapshot = await ctx.fleetRepository.getSnapshot(ctx.now);
      const stack = snapshot.stacks.find((candidate) => candidate.id === input.id);
      if (!stack) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return evaluateRunnerStack(stack, ctx.now, ctx.freshnessPolicy);
    }),
  }),
});

export type AppRouter = typeof appRouter;
