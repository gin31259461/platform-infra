import { describe, expect, it, vi } from "vitest";

import {
  GitLabProjectResolutionError,
  GitLabProjectUnavailableError,
  RestGitLabProjectResolver,
} from "./project-client";

describe("GitLab Project resolver", () => {
  it("resolves one exact nested Project path without listing Projects", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://gitlab.example.test/api/v4/projects/platform%2Fweb%2Fapp");
      expect(init).toMatchObject({ method: "GET", redirect: "error" });
      return new Response(JSON.stringify({ id: 42, path_with_namespace: "platform/web/app" }));
    });
    const resolver = new RestGitLabProjectResolver({
      baseUrl: "https://gitlab.example.test",
      fetch: fetchImplementation,
      token: "monitoring-token",
    });

    await expect(resolver.resolve("platform/web/app")).resolves.toEqual({
      id: "42",
      path: "platform/web/app",
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("fails closed for relative paths and mismatched GitLab identities", async () => {
    const resolver = new RestGitLabProjectResolver({
      baseUrl: "https://gitlab.example.test",
      fetch: async () => new Response(JSON.stringify({ id: 42, path_with_namespace: "different/project" })),
      token: "monitoring-token",
    });

    await expect(resolver.resolve("../etc/passwd")).rejects.toThrow();
    await expect(resolver.resolve("expected/project")).rejects.toBeInstanceOf(GitLabProjectResolutionError);
  });

  it("does not reveal whether an unauthorized Project exists", async () => {
    const resolver = new RestGitLabProjectResolver({
      baseUrl: "https://gitlab.example.test",
      fetch: async () => new Response("private response", { status: 403 }),
      token: "monitoring-token",
    });

    await expect(resolver.resolve("private/project")).rejects.toEqual(new GitLabProjectUnavailableError());
  });
});
