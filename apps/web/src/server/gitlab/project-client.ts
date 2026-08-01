import { gitLabProjectPathSchema } from "@gitlab-runner-platform/contracts";
import { z } from "zod";

const tokenSchema = z.string().min(1).max(512).regex(/^\S+$/);
const projectResponseSchema = z.object({
  id: z.number().int().positive().safe(),
  path_with_namespace: gitLabProjectPathSchema,
}).passthrough();

export type GitLabProjectIdentity = {
  id: string;
  path: string;
};

export class GitLabProjectResolutionError extends Error {
  constructor() {
    super("GitLab Project resolution failed");
    this.name = "GitLabProjectResolutionError";
  }
}

export class GitLabProjectUnavailableError extends Error {
  constructor() {
    super("GitLab Project is missing or not visible to the monitoring credential");
    this.name = "GitLabProjectUnavailableError";
  }
}

function projectUrl(baseUrl: string, projectPath: string): URL {
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
  url.pathname = `${url.pathname.replace(/\/$/, "")}/api/v4/projects/${encodeURIComponent(projectPath)}`;
  return url;
}

export class RestGitLabProjectResolver {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly token: string;

  constructor(options: { baseUrl: string; fetch?: typeof fetch; token: string }) {
    this.baseUrl = options.baseUrl;
    this.fetchImplementation = options.fetch ?? fetch;
    this.token = tokenSchema.parse(options.token);
  }

  async resolve(projectPath: string): Promise<GitLabProjectIdentity> {
    const path = gitLabProjectPathSchema.parse(projectPath);
    let response: Response;
    try {
      response = await this.fetchImplementation(projectUrl(this.baseUrl, path), {
        headers: { Accept: "application/json", "PRIVATE-TOKEN": this.token },
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new GitLabProjectResolutionError();
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      throw new GitLabProjectUnavailableError();
    }
    if (!response.ok) throw new GitLabProjectResolutionError();

    try {
      const responseText = await response.text();
      if (responseText.length > 32_768) throw new Error("response too large");
      const project = projectResponseSchema.parse(JSON.parse(responseText));
      if (project.path_with_namespace !== path) throw new Error("project identity mismatch");
      return { id: String(project.id), path: project.path_with_namespace };
    } catch {
      throw new GitLabProjectResolutionError();
    }
  }
}
