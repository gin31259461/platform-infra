import { randomUUID } from "node:crypto";

import { gitLabProjectPathSchema } from "@gitlab-runner-platform/contracts";

import type { PrismaClient } from "../../../generated/prisma/client";
import type { GitLabProjectIdentity } from "../gitlab/project-client";

export class ProjectAllowlistConflictError extends Error {
  constructor() {
    super("GitLab Project identity conflicts with the existing allowlist");
    this.name = "ProjectAllowlistConflictError";
  }
}

export async function allowGitLabProject(input: {
  actorId: string;
  now: Date;
  prisma: PrismaClient;
  project: GitLabProjectIdentity;
}): Promise<{ id: string; path: string }> {
  const path = gitLabProjectPathSchema.parse(input.project.path);
  if (!/^[1-9][0-9]{0,19}$/.test(input.project.id)) {
    throw new Error("GitLab Project ID is invalid");
  }

  return input.prisma.$transaction(async (transaction) => {
    const existing = await transaction.gitLabProjectRef.findFirst({
      where: { OR: [{ gitlabProjectId: input.project.id }, { path }] },
    });
    if (existing && (existing.gitlabProjectId !== input.project.id || existing.path !== path)) {
      throw new ProjectAllowlistConflictError();
    }
    const project = existing
      ? await transaction.gitLabProjectRef.update({
        data: { enabled: true },
        where: { id: existing.id },
      })
      : await transaction.gitLabProjectRef.create({
        data: {
          enabled: true,
          gitlabProjectId: input.project.id,
          id: `project_${input.project.id}`,
          path,
        },
      });
    await transaction.auditEvent.create({
      data: {
        actorId: input.actorId,
        correlationId: randomUUID(),
        eventType: existing ? "provisioning.project.reenabled" : "provisioning.project.allowed",
        id: randomUUID(),
        occurredAt: input.now,
        payload: { gitlabProjectId: input.project.id, path },
        targetId: project.id,
        targetType: "gitlab-project-ref",
      },
    });
    return { id: project.id, path: project.path };
  });
}
