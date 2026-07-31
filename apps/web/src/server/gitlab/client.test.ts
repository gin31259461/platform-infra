import { describe, expect, it, vi } from "vitest";

import {
  GitLabAuthenticationError,
  GitLabRunnerUnavailableError,
  GraphQlGitLabRunnerConnector,
} from "./client";

const observedAt = new Date("2026-07-31T09:00:00.000Z");

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { headers, status });
}

describe("GraphQL GitLab Runner connector", () => {
  it("queries only the configured Runner and normalizes read-only fields", async () => {
    const request = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args;
      return response({
        data: {
          runner: {
            contactedAt: "2026-07-31T08:59:48.000Z",
            id: "gid://gitlab/Ci::Runner/101",
            jobExecutionStatus: "RUNNING",
            paused: false,
            status: "ONLINE",
          },
        },
      });
    });
    const connector = new GraphQlGitLabRunnerConnector({
      baseUrl: "https://gitlab.example.invalid",
      fetch: request as unknown as typeof fetch,
      token: "read-api-token",
    });

    await expect(connector.observeRunner("101", observedAt)).resolves.toEqual({
      contactedAt: "2026-07-31T08:59:48.000Z",
      contractVersion: "1.0",
      jobExecutionStatus: "running",
      observedAt: "2026-07-31T09:00:00.000Z",
      runnerRecordId: "101",
      state: "online",
    });
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0];
    expect(String(url)).toBe("https://gitlab.example.invalid/api/graphql");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      variables: { id: "gid://gitlab/Ci::Runner/101" },
    });
    expect(String(init?.body)).not.toContain("projects");
    expect(init?.redirect).toBe("error");
  });

  it("treats paused as an explicit state independent of connectivity", async () => {
    const connector = new GraphQlGitLabRunnerConnector({
      baseUrl: "https://gitlab.example.invalid/gitlab/",
      fetch: vi.fn(async () => response({
        data: { runner: {
          contactedAt: null,
          id: "gid://gitlab/Ci::Runner/102",
          jobExecutionStatus: "IDLE",
          paused: true,
          status: "OFFLINE",
        } },
      })) as typeof fetch,
      token: "read-api-token",
    });

    await expect(connector.observeRunner("102", observedAt)).resolves.toMatchObject({
      jobExecutionStatus: "idle",
      state: "paused",
    });
  });

  it("maps authentication, rate-limit, and hidden Runner failures without response details", async () => {
    const create = (fetchImplementation: typeof fetch) => new GraphQlGitLabRunnerConnector({
      baseUrl: "https://gitlab.example.invalid",
      fetch: fetchImplementation,
      token: "read-api-token",
    });

    await expect(create(vi.fn(async () => response({}, 401)) as typeof fetch)
      .observeRunner("101", observedAt)).rejects.toBeInstanceOf(GitLabAuthenticationError);
    await expect(create(vi.fn(async () => response({}, 429, { "Retry-After": "90" })) as typeof fetch)
      .observeRunner("101", observedAt)).rejects.toMatchObject({ retryAfterSeconds: 90 });
    await expect(create(vi.fn(async () => response({ data: { runner: null } })) as typeof fetch)
      .observeRunner("101", observedAt)).rejects.toBeInstanceOf(GitLabRunnerUnavailableError);
  });

  it("rejects insecure base URLs and malformed Runner Record IDs", async () => {
    expect(() => new GraphQlGitLabRunnerConnector({
      baseUrl: "http://gitlab.example.invalid",
      token: "read-api-token",
    })).toThrow("HTTPS");

    const connector = new GraphQlGitLabRunnerConnector({
      baseUrl: "https://gitlab.example.invalid",
      fetch: vi.fn() as typeof fetch,
      token: "read-api-token",
    });
    await expect(connector.observeRunner("../../runners", observedAt)).rejects.toThrow();
  });
});
