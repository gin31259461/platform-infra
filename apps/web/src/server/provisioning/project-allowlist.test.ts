import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../../generated/prisma/client";
import { allowGitLabProject, ProjectAllowlistConflictError } from "./project-allowlist";

function prismaWithTransaction(transaction: object): PrismaClient {
  return {
    $transaction: vi.fn(async (callback: (client: object) => unknown) => callback(transaction)),
  } as unknown as PrismaClient;
}

describe("Project allowlist", () => {
  it("persists a GitLab-resolved identity with a redacted audit event", async () => {
    const create = vi.fn(async ({ data }) => ({ ...data }));
    const audit = vi.fn(async () => undefined);
    const transaction = {
      auditEvent: { create: audit },
      gitLabProjectRef: {
        create,
        findFirst: vi.fn(async () => null),
        update: vi.fn(),
      },
    };

    await expect(allowGitLabProject({
      actorId: "project-allowlist-cli",
      now: new Date("2026-08-01T08:00:00.000Z"),
      prisma: prismaWithTransaction(transaction),
      project: { id: "42", path: "platform/web" },
    })).resolves.toEqual({ id: "project_42", path: "platform/web" });
    expect(create).toHaveBeenCalledWith({
      data: {
        enabled: true,
        gitlabProjectId: "42",
        id: "project_42",
        path: "platform/web",
      },
    });
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/token|credential/i);
  });

  it("rejects a path or ID collision instead of silently changing scope", async () => {
    const transaction = {
      gitLabProjectRef: {
        findFirst: vi.fn(async () => ({
          gitlabProjectId: "41",
          id: "project_41",
          path: "platform/web",
        })),
      },
    };

    await expect(allowGitLabProject({
      actorId: "project-allowlist-cli",
      now: new Date(),
      prisma: prismaWithTransaction(transaction),
      project: { id: "42", path: "platform/web" },
    })).rejects.toBeInstanceOf(ProjectAllowlistConflictError);
  });
});
