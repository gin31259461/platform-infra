import { z } from "zod";

const tokenSchema = z.string().min(1).max(512).regex(/^\S+$/);
const safeDescriptionSchema = z.string().max(255).refine(
  (value) => !/[\u0000-\u001f\u007f]/.test(value),
  "Runner description contains control characters",
);
const runnerListSchema = z.array(z.object({
  description: safeDescriptionSchema.nullable(),
  id: z.number().int().positive().safe(),
  job_execution_status: z.string().max(40).optional(),
  paused: z.boolean().optional(),
  runner_type: z.string().max(40),
  status: z.string().max(40),
}).passthrough()).max(100);
const runnerProjectsSchema = z.object({
  data: z.object({
    runner: z.object({
      id: z.string(),
      projects: z.object({
        nodes: z.array(z.object({
          fullPath: z.string().min(3).max(255).regex(/^[^\s/]+(?:\/[^\s/]+)+$/),
        }).strict()).max(100),
        pageInfo: z.object({ hasNextPage: z.boolean() }).passthrough(),
      }).strict(),
    }).strict().nullable(),
  }).strict().optional(),
  errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
}).passthrough();

const runnerProjectsQuery = `query RunnerPlatformDiscoveryProjects($id: CiRunnerID!) {
  runner(id: $id) {
    id
    projects(first: 100) {
      nodes {
        fullPath
      }
      pageInfo {
        hasNextPage
      }
    }
  }
}`;

const workloadTags = {
  dotnet: ["dotnet", "podman"],
  frontend: ["frontend", "podman"],
} as const;

export type DiscoveredGitLabRunner = {
  description: string | null;
  id: string;
  jobExecutionStatus: "idle" | "running" | "unknown";
  paused: boolean | null;
  projectPaths: string[];
  runnerType: "project_type";
  status: "online" | "offline" | "stale" | "never_contacted" | "unknown";
  workloads: Array<keyof typeof workloadTags>;
};

export type GitLabRunnerDiscoveryOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  token: string;
};

export class GitLabRunnerDiscoveryError extends Error {
  constructor() {
    super("GitLab Runner discovery failed");
    this.name = "GitLabRunnerDiscoveryError";
  }
}

export class GitLabRunnerDiscoveryAuthenticationError extends Error {
  constructor() {
    super("GitLab rejected the discovery credential");
    this.name = "GitLabRunnerDiscoveryAuthenticationError";
  }
}

export class GitLabRunnerDiscoveryRateLimitError extends Error {
  constructor() {
    super("GitLab rate limited Runner discovery");
    this.name = "GitLabRunnerDiscoveryRateLimitError";
  }
}

function apiBaseUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new Error("GITLAB_BASE_URL must be an HTTPS URL without credentials, query, or fragment");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/v4/runners`;
  return url;
}

function normalizeStatus(status: string): DiscoveredGitLabRunner["status"] {
  if (["online", "offline", "stale", "never_contacted"].includes(status)) {
    return status as DiscoveredGitLabRunner["status"];
  }
  return "unknown";
}

function normalizeJobStatus(status: string | undefined): DiscoveredGitLabRunner["jobExecutionStatus"] {
  if (status === "idle" || status === "running") {
    return status;
  }
  return "unknown";
}

export class RestGitLabRunnerDiscovery {
  private readonly endpoint: URL;
  private readonly fetchImplementation: typeof fetch;
  private readonly graphQlEndpoint: URL;
  private readonly token: string;

  constructor(options: GitLabRunnerDiscoveryOptions) {
    this.endpoint = apiBaseUrl(options.baseUrl);
    this.graphQlEndpoint = new URL(this.endpoint);
    this.graphQlEndpoint.pathname = this.graphQlEndpoint.pathname.replace(/\/api\/v4\/runners$/, "/api/graphql");
    this.graphQlEndpoint.search = "";
    this.fetchImplementation = options.fetch ?? fetch;
    this.token = tokenSchema.parse(options.token);
  }

  async discover(): Promise<DiscoveredGitLabRunner[]> {
    const candidates = new Map<string, DiscoveredGitLabRunner>();
    for (const [workload, tags] of Object.entries(workloadTags) as Array<
      [keyof typeof workloadTags, (typeof workloadTags)[keyof typeof workloadTags]]
    >) {
      await this.discoverWorkload(workload, tags, candidates);
    }
    const sorted = [...candidates.values()].sort((left, right) => Number(left.id) - Number(right.id));
    for (const candidate of sorted) {
      candidate.projectPaths = await this.discoverProjects(candidate.id);
    }
    return sorted;
  }

  private async discoverWorkload(
    workload: keyof typeof workloadTags,
    tags: readonly string[],
    candidates: Map<string, DiscoveredGitLabRunner>,
  ): Promise<void> {
    let page = 1;
    for (let pageCount = 0; pageCount < 10; pageCount += 1) {
      const url = new URL(this.endpoint);
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", "100");
      url.searchParams.set("tag_list", tags.join(","));
      url.searchParams.set("type", "project_type");

      let response: Response;
      try {
        response = await this.fetchImplementation(url, {
          headers: { Accept: "application/json", "PRIVATE-TOKEN": this.token },
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new GitLabRunnerDiscoveryError();
      }
      if (response.status === 401 || response.status === 403) {
        throw new GitLabRunnerDiscoveryAuthenticationError();
      }
      if (response.status === 429) {
        throw new GitLabRunnerDiscoveryRateLimitError();
      }
      if (!response.ok) {
        throw new GitLabRunnerDiscoveryError();
      }

      const body = await response.text();
      if (Buffer.byteLength(body, "utf8") > 256 * 1_024) {
        throw new GitLabRunnerDiscoveryError();
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(body);
      } catch {
        throw new GitLabRunnerDiscoveryError();
      }
      const runners = runnerListSchema.safeParse(decoded);
      if (!runners.success || runners.data.some((runner) => runner.runner_type !== "project_type")) {
        throw new GitLabRunnerDiscoveryError();
      }

      for (const runner of runners.data) {
        const id = String(runner.id);
        const existing = candidates.get(id);
        if (existing) {
          if (!existing.workloads.includes(workload)) {
            existing.workloads.push(workload);
          }
          continue;
        }
        candidates.set(id, {
          description: runner.description,
          id,
          jobExecutionStatus: normalizeJobStatus(runner.job_execution_status),
          paused: runner.paused ?? null,
          projectPaths: [],
          runnerType: "project_type",
          status: normalizeStatus(runner.status),
          workloads: [workload],
        });
      }

      const nextPage = response.headers.get("x-next-page");
      if (!nextPage) {
        return;
      }
      if (!/^[1-9][0-9]{0,3}$/.test(nextPage) || Number(nextPage) <= page) {
        throw new GitLabRunnerDiscoveryError();
      }
      page = Number(nextPage);
    }
    throw new GitLabRunnerDiscoveryError();
  }

  private async discoverProjects(runnerId: string): Promise<string[]> {
    const globalId = `gid://gitlab/Ci::Runner/${runnerId}`;
    let response: Response;
    try {
      response = await this.fetchImplementation(this.graphQlEndpoint, {
        body: JSON.stringify({
          operationName: "RunnerPlatformDiscoveryProjects",
          query: runnerProjectsQuery,
          variables: { id: globalId },
        }),
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new GitLabRunnerDiscoveryError();
    }
    if (response.status === 401 || response.status === 403) {
      throw new GitLabRunnerDiscoveryAuthenticationError();
    }
    if (response.status === 429) {
      throw new GitLabRunnerDiscoveryRateLimitError();
    }
    if (!response.ok) {
      throw new GitLabRunnerDiscoveryError();
    }

    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > 256 * 1_024) {
      throw new GitLabRunnerDiscoveryError();
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(body);
    } catch {
      throw new GitLabRunnerDiscoveryError();
    }
    const result = runnerProjectsSchema.safeParse(decoded);
    const runner = result.success ? result.data.data?.runner : null;
    if (
      !result.success
      || (result.data.errors?.length ?? 0) > 0
      || !runner
      || runner.id !== globalId
      || runner.projects.pageInfo.hasNextPage
    ) {
      throw new GitLabRunnerDiscoveryError();
    }
    return [...new Set(runner.projects.nodes.map((project) => project.fullPath))].sort();
  }
}
