import { describe, expect, it, vi } from "vitest";

import {
  GitLabRunnerCreatedButHandoffFailedError,
  GitLabRunnerCreationOutcomeUnknownError,
  GitLabRunnerCreationRejectedError,
  RestGitLabProjectRunnerProvisioner,
} from "./provisioning-client";

const request = {
  accessLevel: "ref_protected" as const,
  description: "runner-platform-operation-01",
  locked: true as const,
  paused: true as const,
  projectId: "42",
  runUntagged: false as const,
  tags: ["frontend", "podman"],
};
const runnerAuthenticationToken = ["glrt", "secret-value"].join("-");

describe("GitLab Project Runner provisioner", () => {
  it("creates one Project Runner and sends its token only to the handoff", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ "PRIVATE-TOKEN": "provisioning-token" });
      expect(String(init?.body)).toContain("runner_type=project_type");
      expect(String(init?.body)).toContain("project_id=42");
      expect(String(init?.body)).toContain("locked=true");
      expect(String(init?.body)).toContain("paused=true");
      expect(String(init?.body)).toContain("run_untagged=false");
      return new Response(JSON.stringify({
        id: 9171,
        token: runnerAuthenticationToken,
        token_expires_at: null,
      }), { status: 201 });
    });
    const accept = vi.fn(async () => undefined);
    const provisioner = new RestGitLabProjectRunnerProvisioner({
      baseUrl: "https://gitlab.example.test",
      fetch: fetchImplementation,
      token: "provisioning-token",
    });

    await expect(provisioner.createAndHandoff(request, { accept })).resolves.toEqual({
      runnerRecordId: "9171",
    });
    expect(accept).toHaveBeenCalledWith({
      authenticationToken: runnerAuthenticationToken,
      runnerRecordId: "9171",
      tokenExpiresAt: null,
    });
  });

  it("does not retry or claim failure when GitLab's outcome is ambiguous", async () => {
    for (const response of [
      () => Promise.reject(new Error("connection reset")),
      () => Promise.resolve(new Response("unavailable", { status: 503 })),
      () => Promise.resolve(new Response("not-json", { status: 201 })),
    ]) {
      const fetchImplementation = vi.fn<typeof fetch>(response);
      const provisioner = new RestGitLabProjectRunnerProvisioner({
        baseUrl: "https://gitlab.example.test",
        fetch: fetchImplementation,
        token: "provisioning-token",
      });

      await expect(provisioner.createAndHandoff(request, { accept: async () => undefined }))
        .rejects.toBeInstanceOf(GitLabRunnerCreationOutcomeUnknownError);
      expect(fetchImplementation).toHaveBeenCalledOnce();
    }
  });

  it("classifies a determinate GitLab rejection without exposing its response", async () => {
    const provisioner = new RestGitLabProjectRunnerProvisioner({
      baseUrl: "https://gitlab.example.test",
      fetch: async () => new Response("token rejected: glpat-sensitive", { status: 403 }),
      token: "provisioning-token",
    });

    await expect(provisioner.createAndHandoff(request, { accept: async () => undefined }))
      .rejects.toEqual(new GitLabRunnerCreationRejectedError());
  });

  it("preserves the Runner Record ID when the secret handoff fails", async () => {
    const provisioner = new RestGitLabProjectRunnerProvisioner({
      baseUrl: "https://gitlab.example.test",
      fetch: async () => new Response(JSON.stringify({ id: 9171, token: runnerAuthenticationToken }), { status: 201 }),
      token: "provisioning-token",
    });

    await expect(provisioner.createAndHandoff(request, {
      accept: async () => { throw new Error("host unavailable"); },
    })).rejects.toEqual(new GitLabRunnerCreatedButHandoffFailedError("9171"));
  });
});
