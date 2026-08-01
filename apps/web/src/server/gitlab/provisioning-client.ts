import { z } from "zod";

const tokenSchema = z.string().min(1).max(512).regex(/^\S+$/);
const numericIdSchema = z.string().regex(/^[1-9][0-9]{0,19}$/);
const descriptionSchema = z.string().min(1).max(255).refine(
  (value) => !/[\u0000-\u001f\u007f]/.test(value),
  "Runner description contains control characters",
);
const tagSchema = z.string().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/);
const createdRunnerSchema = z.object({
  id: z.number().int().positive().safe(),
  token: z.string().min(1).max(512).regex(/^glrt-[^\s]+$/),
  token_expires_at: z.iso.datetime().nullable().optional(),
}).passthrough();

export type ProjectRunnerCreationRequest = {
  accessLevel: "not_protected" | "ref_protected";
  description: string;
  locked: true;
  paused: true;
  projectId: string;
  runUntagged: false;
  tags: string[];
};

export type RunnerRegistrationSecret = {
  authenticationToken: string;
  runnerRecordId: string;
  tokenExpiresAt: string | null;
};

export interface RunnerRegistrationHandoff {
  accept(secret: RunnerRegistrationSecret): Promise<void>;
}

export class GitLabRunnerCreationRejectedError extends Error {
  constructor() {
    super("GitLab rejected Project Runner creation");
    this.name = "GitLabRunnerCreationRejectedError";
  }
}

export class GitLabRunnerCreationRateLimitError extends Error {
  constructor() {
    super("GitLab rate limited Project Runner creation");
    this.name = "GitLabRunnerCreationRateLimitError";
  }
}

export class GitLabRunnerCreationOutcomeUnknownError extends Error {
  constructor() {
    super("GitLab Project Runner creation has an unknown outcome");
    this.name = "GitLabRunnerCreationOutcomeUnknownError";
  }
}

export class GitLabRunnerCreatedButHandoffFailedError extends Error {
  constructor(readonly runnerRecordId: string) {
    super("GitLab created the Runner Record but registration handoff failed");
    this.name = "GitLabRunnerCreatedButHandoffFailedError";
  }
}

function runnerCreationUrl(baseUrl: string): URL {
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
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/v4/user/runners`;
  return url;
}

export class RestGitLabProjectRunnerProvisioner {
  private readonly endpoint: URL;
  private readonly fetchImplementation: typeof fetch;
  private readonly token: string;

  constructor(options: { baseUrl: string; fetch?: typeof fetch; token: string }) {
    this.endpoint = runnerCreationUrl(options.baseUrl);
    this.fetchImplementation = options.fetch ?? fetch;
    this.token = tokenSchema.parse(options.token);
  }

  async createAndHandoff(
    input: ProjectRunnerCreationRequest,
    handoff: RunnerRegistrationHandoff,
  ): Promise<{ runnerRecordId: string }> {
    const projectId = numericIdSchema.parse(input.projectId);
    const description = descriptionSchema.parse(input.description);
    const tags = z.array(tagSchema).min(1).max(20).parse(input.tags);
    const body = new URLSearchParams({
      access_level: input.accessLevel,
      description,
      locked: String(input.locked),
      paused: String(input.paused),
      project_id: projectId,
      run_untagged: String(input.runUntagged),
      runner_type: "project_type",
      tag_list: tags.join(","),
    });

    let response: Response;
    try {
      response = await this.fetchImplementation(this.endpoint, {
        body,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "PRIVATE-TOKEN": this.token,
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new GitLabRunnerCreationOutcomeUnknownError();
    }

    if (response.status === 429) throw new GitLabRunnerCreationRateLimitError();
    if (response.status >= 400 && response.status < 500) throw new GitLabRunnerCreationRejectedError();
    if (!response.ok) throw new GitLabRunnerCreationOutcomeUnknownError();

    let created: z.infer<typeof createdRunnerSchema>;
    try {
      const responseText = await response.text();
      if (responseText.length > 8_192) throw new Error("response too large");
      created = createdRunnerSchema.parse(JSON.parse(responseText));
    } catch {
      throw new GitLabRunnerCreationOutcomeUnknownError();
    }

    const runnerRecordId = String(created.id);
    try {
      await handoff.accept({
        authenticationToken: created.token,
        runnerRecordId,
        tokenExpiresAt: created.token_expires_at ?? null,
      });
    } catch {
      throw new GitLabRunnerCreatedButHandoffFailedError(runnerRecordId);
    }
    return { runnerRecordId };
  }
}
