import { describe, expect, it, vi } from "vitest";

import {
  GitLabRunnerDiscoveryAuthenticationError,
  RestGitLabRunnerDiscovery,
} from "./discovery";

function response(body: unknown, options: { headers?: HeadersInit; status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: options.headers,
    status: options.status ?? 200,
  });
}

const runner = (id: number, description: string) => ({
  description,
  id,
  job_execution_status: "idle",
  paused: false,
  runner_type: "project_type",
  status: "online",
});

describe("REST GitLab Runner discovery", () => {
  it("lists only tag-filtered project Runner candidates and deduplicates them", async () => {
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === "POST") {
        const id = JSON.parse(String(init.body)).variables.id as string;
        return response({ data: { runner: {
          id,
          projects: {
            nodes: [{ fullPath: id.endsWith("101") ? "shop/frontend" : "core/services" }],
            pageInfo: { hasNextPage: false },
          },
        } } });
      }
      return url.searchParams.get("tag_list") === "dotnet,podman"
        ? response([runner(102, "dotnet runner"), runner(103, "shared candidate")])
        : response([runner(101, "frontend runner"), runner(103, "shared candidate")]);
    });
    const discovery = new RestGitLabRunnerDiscovery({
      baseUrl: "https://gitlab.example.invalid/gitlab/",
      fetch: request as unknown as typeof fetch,
      token: "read-api-token",
    });

    await expect(discovery.discover()).resolves.toEqual([
      expect.objectContaining({ id: "101", projectPaths: ["shop/frontend"], workloads: ["frontend"] }),
      expect.objectContaining({ id: "102", projectPaths: ["core/services"], workloads: ["dotnet"] }),
      expect.objectContaining({ id: "103", projectPaths: ["core/services"], workloads: ["dotnet", "frontend"] }),
    ]);
    expect(request).toHaveBeenCalledTimes(5);
    for (const [input, init] of request.mock.calls.filter((call) => call[1]?.method === "GET")) {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/gitlab/api/v4/runners");
      expect(url.searchParams.get("type")).toBe("project_type");
      expect(url.searchParams.get("per_page")).toBe("100");
      expect(url.searchParams.get("tag_list")).toMatch(/^(dotnet|frontend),podman$/);
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      expect(new Headers(init?.headers).get("PRIVATE-TOKEN")).toBe("read-api-token");
    }
    const graphQlCall = request.mock.calls.find((call) => call[1]?.method === "POST");
    expect(new Headers(graphQlCall?.[1]?.headers).get("Authorization")).toBe("Bearer read-api-token");
    expect(String(graphQlCall?.[1]?.body)).not.toContain("token");
  });

  it("follows bounded GitLab pagination", async () => {
    const request = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === "POST") {
        const id = JSON.parse(String(init.body)).variables.id as string;
        return response({ data: { runner: {
          id,
          projects: { nodes: [{ fullPath: "example/project" }], pageInfo: { hasNextPage: false } },
        } } });
      }
      if (url.searchParams.get("tag_list") === "dotnet,podman") {
        return response(url.searchParams.get("page") === "1" ? [runner(101, "first")] : [runner(102, "second")], {
          headers: url.searchParams.get("page") === "1" ? { "X-Next-Page": "2" } : undefined,
        });
      }
      return response([]);
    });
    const discovery = new RestGitLabRunnerDiscovery({
      baseUrl: "https://gitlab.example.invalid",
      fetch: request as unknown as typeof fetch,
      token: "read-api-token",
    });

    await expect(discovery.discover()).resolves.toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(5);
  });

  it("fails closed on authentication errors and insecure URLs", async () => {
    const discovery = new RestGitLabRunnerDiscovery({
      baseUrl: "https://gitlab.example.invalid",
      fetch: vi.fn(async () => response({}, { status: 401 })) as typeof fetch,
      token: "read-api-token",
    });
    await expect(discovery.discover()).rejects.toBeInstanceOf(GitLabRunnerDiscoveryAuthenticationError);
    expect(() => new RestGitLabRunnerDiscovery({
      baseUrl: "http://gitlab.example.invalid",
      token: "read-api-token",
    })).toThrow("HTTPS");
  });

  it("rejects response fields that could inject terminal control sequences", async () => {
    const discovery = new RestGitLabRunnerDiscovery({
      baseUrl: "https://gitlab.example.invalid",
      fetch: vi.fn(async () => response([runner(101, "unsafe\u001b[31m")])) as typeof fetch,
      token: "read-api-token",
    });
    await expect(discovery.discover()).rejects.toThrow("discovery failed");
  });
});
