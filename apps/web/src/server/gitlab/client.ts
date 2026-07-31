import {
  contractVersion,
  gitlabRunnerObservationSchema,
  type GitLabJobExecutionStatus,
  type GitLabRunnerObservation,
  type GitLabRunnerState,
} from "@gitlab-runner-platform/contracts";
import { z } from "zod";

const runnerRecordIdSchema = z.string().regex(/^[1-9][0-9]{0,19}$/);
const tokenSchema = z.string().min(1).max(512).regex(/^\S+$/);

const runnerResponseSchema = z.object({
  data: z.object({
    runner: z.object({
      contactedAt: z.string().nullable(),
      id: z.string(),
      jobExecutionStatus: z.string().nullable(),
      paused: z.boolean(),
      status: z.string().nullable(),
    }).strict().nullable(),
  }).strict().optional(),
  errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
}).passthrough();

const runnerQuery = `query RunnerPlatformRunner($id: CiRunnerID!) {
  runner(id: $id) {
    id
    paused
    status
    contactedAt
    jobExecutionStatus
  }
}`;

export class GitLabAuthenticationError extends Error {
  constructor() {
    super("GitLab rejected the connector credential");
    this.name = "GitLabAuthenticationError";
  }
}

export class GitLabRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number | null) {
    super("GitLab rate limited the connector");
    this.name = "GitLabRateLimitError";
  }
}

export class GitLabRunnerUnavailableError extends Error {
  constructor() {
    super("GitLab Runner is missing or not visible to the connector");
    this.name = "GitLabRunnerUnavailableError";
  }
}

export class GitLabRequestError extends Error {
  constructor() {
    super("GitLab Runner query failed");
    this.name = "GitLabRequestError";
  }
}

export interface GitLabRunnerConnector {
  observeRunner(runnerRecordId: string, observedAt: Date): Promise<GitLabRunnerObservation>;
}

export type GitLabClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  token: string;
};

function graphQlUrl(baseUrl: string): URL {
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
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/graphql`;
  return url;
}

function retryAfterSeconds(value: string | null, now: Date): number | null {
  if (value === null) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.ceil(seconds), 3_600);
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return null;
  }
  return Math.min(Math.max(Math.ceil((date - now.getTime()) / 1_000), 0), 3_600);
}

function normalizeState(paused: boolean, status: string | null): GitLabRunnerState {
  if (paused) {
    return "paused";
  }
  const normalized: Record<string, GitLabRunnerState> = {
    NEVER_CONTACTED: "never_contacted",
    NOT_CONNECTED: "never_contacted",
    OFFLINE: "offline",
    ONLINE: "online",
    STALE: "stale",
  };
  return status === null ? "unknown" : normalized[status] ?? "unknown";
}

function normalizeJobStatus(status: string | null): GitLabJobExecutionStatus {
  if (status === "IDLE") {
    return "idle";
  }
  if (status === "RUNNING") {
    return "running";
  }
  return "unknown";
}

export class GraphQlGitLabRunnerConnector implements GitLabRunnerConnector {
  private readonly endpoint: URL;
  private readonly fetchImplementation: typeof fetch;
  private readonly token: string;

  constructor(options: GitLabClientOptions) {
    this.endpoint = graphQlUrl(options.baseUrl);
    this.fetchImplementation = options.fetch ?? fetch;
    this.token = tokenSchema.parse(options.token);
  }

  async observeRunner(runnerRecordId: string, observedAt: Date): Promise<GitLabRunnerObservation> {
    const recordId = runnerRecordIdSchema.parse(runnerRecordId);
    let response: Response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        body: JSON.stringify({
          operationName: "RunnerPlatformRunner",
          query: runnerQuery,
          variables: { id: `gid://gitlab/Ci::Runner/${recordId}` },
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
      throw new GitLabRequestError();
    }

    if (response.status === 401 || response.status === 403) {
      throw new GitLabAuthenticationError();
    }
    if (response.status === 429) {
      throw new GitLabRateLimitError(retryAfterSeconds(response.headers.get("retry-after"), observedAt));
    }
    if (!response.ok) {
      throw new GitLabRequestError();
    }

    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > 64 * 1_024) {
      throw new GitLabRequestError();
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(body);
    } catch {
      throw new GitLabRequestError();
    }
    const result = runnerResponseSchema.safeParse(decoded);
    if (!result.success) {
      throw new GitLabRequestError();
    }
    if ((result.data.errors?.length ?? 0) > 0) {
      throw new GitLabRunnerUnavailableError();
    }
    const runner = result.data.data?.runner;
    if (!runner) {
      throw new GitLabRunnerUnavailableError();
    }
    if (runner.id !== `gid://gitlab/Ci::Runner/${recordId}`) {
      throw new GitLabRequestError();
    }

    return gitlabRunnerObservationSchema.parse({
      contactedAt: runner.contactedAt,
      contractVersion,
      jobExecutionStatus: normalizeJobStatus(runner.jobExecutionStatus),
      observedAt: observedAt.toISOString(),
      runnerRecordId: recordId,
      state: normalizeState(runner.paused, runner.status),
    });
  }
}
