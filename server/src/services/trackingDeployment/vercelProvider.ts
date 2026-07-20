import type { TrackingSite } from "./cloudflareProvider.js";

type Fetch = typeof fetch;

type VercelConfig = {
  token: string;
  githubToken: string;
  analyticsOrigin: string;
  teamId?: string;
};

type Project = {
  id: string;
  name: string;
  framework?: string;
  rootDirectory?: string | null;
  link?: { type?: string; org?: string; repo?: string; productionBranch?: string };
};

type Inspection = {
  site: TrackingSite;
  project: Project;
  owner: string;
  repo: string;
  base: string;
  filePath: string;
  branch: string;
  installed: boolean;
  conflict: boolean;
  cspCompatible: boolean;
  desired: string;
};

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

class ApiClient {
  constructor(
    private baseUrl: string,
    private token: string,
    protected fetchImpl: Fetch
  ) {}

  protected async request(pathname: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.token}`);
    headers.set("accept", "application/json");
    headers.set("user-agent", "AgencyAnalyticsInstaller/1.0");
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, { ...init, headers });
    const payload = (await response.json().catch(() => null)) as any;
    if (!response.ok) {
      throw new ApiError(payload?.error?.message || payload?.message || `HTTP ${response.status}`, response.status);
    }
    return payload;
  }
}

class VercelClient extends ApiClient {
  constructor(
    token: string,
    fetchImpl: Fetch,
    private teamId?: string
  ) {
    super("https://api.vercel.com", token, fetchImpl);
  }

  private scoped(pathname: string) {
    if (!this.teamId) return pathname;
    const url = new URL(pathname, "https://api.vercel.com");
    url.searchParams.set("teamId", this.teamId);
    return `${url.pathname}${url.search}`;
  }

  getProject(idOrName: string): Promise<Project> {
    return this.request(this.scoped(`/v9/projects/${encodeURIComponent(idOrName)}`));
  }

  async listProjects() {
    const projects: Project[] = [];
    let until: string | undefined;
    do {
      const query = new URLSearchParams({ limit: "100" });
      if (until) query.set("until", until);
      const payload = await this.request(this.scoped(`/v9/projects?${query}`));
      projects.push(...(payload.projects ?? []));
      until = payload.pagination?.next ? String(payload.pagination.next) : undefined;
    } while (until);
    return projects;
  }

  async listDomains(projectId: string) {
    const payload = await this.request(this.scoped(`/v9/projects/${encodeURIComponent(projectId)}/domains?limit=100`));
    return (payload.domains ?? []) as Array<{ name: string }>;
  }

  async findProjectByDomain(hostname: string) {
    const projects = await this.listProjects();
    for (const project of projects) {
      const domains = await this.listDomains(project.id);
      if (domains.some(domain => domain.name.toLowerCase() === hostname.toLowerCase())) return project;
    }
    return null;
  }

  async findBranchDeployment(projectId: string, branch: string) {
    const query = new URLSearchParams({ projectId, limit: "20" });
    const payload = await this.request(this.scoped(`/v6/deployments?${query}`));
    return payload.deployments?.find((deployment: any) => deployment.meta?.githubCommitRef === branch) ?? null;
  }
}

class GitHubClient extends ApiClient {
  constructor(token: string, fetchImpl: Fetch) {
    super("https://api.github.com", token, fetchImpl);
  }

  async getContent(owner: string, repo: string, filePath: string, ref: string) {
    try {
      return await this.request(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(filePath)}?ref=${encodeURIComponent(ref)}`
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  getBranch(owner: string, repo: string, branch: string) {
    return this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodePath(branch)}`
    );
  }

  createBranch(owner: string, repo: string, branch: string, sha: string) {
    return this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
    });
  }

  putFile(owner: string, repo: string, filePath: string, branch: string, content: string) {
    return this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(filePath)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: "feat: add Agency Analytics tracking",
          content: Buffer.from(content).toString("base64"),
          branch,
        }),
      }
    );
  }

  listPullRequests(owner: string, repo: string, branch: string) {
    const query = new URLSearchParams({ state: "open", head: `${owner}:${branch}` });
    return this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?${query}`);
  }

  createPullRequest(
    owner: string,
    repo: string,
    input: { branch: string; base: string; hostname: string; siteId: number; analyticsOrigin: string }
  ) {
    return this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: "Add Agency Analytics tracking",
        head: input.branch,
        base: input.base,
        body: `Installs the managed Agency Analytics tracker for **${input.hostname}** (site ID \`${input.siteId}\`).\n\nVercel will create a preview deployment. Verify a browser event in ${input.analyticsOrigin} before merging.`,
      }),
    });
  }

  updatePullRequest(owner: string, repo: string, number: number, state: "closed") {
    return this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`, {
      method: "PATCH",
      body: JSON.stringify({ state }),
    });
  }

  deleteBranch(owner: string, repo: string, branch: string) {
    return this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodePath(branch)}`,
      { method: "DELETE" }
    );
  }
}

function encodePath(value: string) {
  return value
    .split("/")
    .map(part => encodeURIComponent(part))
    .join("/");
}

function decodeContent(item: { content: string }) {
  return Buffer.from(item.content.split("\n").join(""), "base64").toString("utf8");
}

function joinPath(...parts: string[]) {
  return parts.filter(Boolean).join("/").split("//").join("/");
}

export function supportsClientInstrumentation(version: string | undefined) {
  const match = String(version ?? "").match(/(?:^|[^\d])(\d+)(?:\.(\d+))?/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major > 15 || (major === 15 && minor >= 3);
}

export function buildInstrumentation(analyticsOrigin: string, siteId: number) {
  return `// Agency Analytics managed tracker. Changes are overwritten by the installer.\nconst existing = document.querySelector('script[data-agency-analytics="managed"]');\n\nif (!existing) {\n  const script = document.createElement("script");\n  script.src = "${analyticsOrigin}/api/script.js";\n  script.setAttribute("data-site-id", "${siteId}");\n  script.setAttribute("data-agency-analytics", "managed");\n  script.defer = true;\n  document.head.appendChild(script);\n}\n`;
}

function cspAllowsOrigin(policy: string | null, directiveName: string, origin: string) {
  if (!policy) return true;
  const directives = Object.fromEntries(
    policy
      .split(";")
      .map(value => value.trim().split(/\s+/))
      .filter(parts => parts[0])
      .map(([name, ...values]) => [name.toLowerCase(), values])
  );
  const sources = directives[directiveName] ?? directives["default-src"];
  if (!sources) return true;
  if (sources.includes("*") || sources.includes("https:")) return true;
  return sources.some((source: string) => source === origin || source === new URL(origin).hostname);
}

function trackerCspCompatible(policy: string | null, analyticsOrigin: string) {
  return (
    cspAllowsOrigin(policy, "script-src", analyticsOrigin) && cspAllowsOrigin(policy, "connect-src", analyticsOrigin)
  );
}

export class VercelTrackingProvider {
  private vercel: VercelClient;
  private github: GitHubClient;

  constructor(
    private config: VercelConfig,
    private fetchImpl: Fetch = fetch
  ) {
    this.vercel = new VercelClient(config.token, fetchImpl, config.teamId);
    this.github = new GitHubClient(config.githubToken, fetchImpl);
  }

  async detectProject(hostname: string) {
    return this.vercel.findProjectByDomain(hostname);
  }

  private async inspect(site: TrackingSite, projectName?: string): Promise<Inspection> {
    const project = projectName
      ? await this.vercel.getProject(projectName)
      : await this.vercel.findProjectByDomain(site.hostname);
    if (!project) throw new Error(`No Vercel project contains ${site.hostname}`);
    if (project.framework !== "nextjs") throw new Error(`${project.name} is not a Next.js project`);
    if (project.link?.type !== "github" || !project.link.org || !project.link.repo) {
      throw new Error(`${project.name} is not connected to a GitHub repository`);
    }

    const owner = project.link.org;
    const repo = project.link.repo;
    const base = project.link.productionBranch || "main";
    const root = project.rootDirectory && project.rootDirectory !== "." ? project.rootDirectory : "";
    const packageItem = await this.github.getContent(owner, repo, joinPath(root, "package.json"), base);
    if (!packageItem?.content) throw new Error(`package.json was not found for ${project.name}`);
    const packageJson = JSON.parse(decodeContent(packageItem));
    const nextVersion = packageJson.dependencies?.next ?? packageJson.devDependencies?.next;
    if (!supportsClientInstrumentation(nextVersion)) {
      throw new Error(
        `${project.name} uses Next.js ${nextVersion ?? "unknown"}; automatic installation requires 15.3+`
      );
    }

    const srcApp = await this.github.getContent(owner, repo, joinPath(root, "src", "app"), base);
    const srcPages = srcApp ? null : await this.github.getContent(owner, repo, joinPath(root, "src", "pages"), base);
    const sourceRoot = srcApp || srcPages ? "src" : "";
    const tsconfig = await this.github.getContent(owner, repo, joinPath(root, "tsconfig.json"), base);
    const filePath = joinPath(root, sourceRoot, `instrumentation-client.${tsconfig ? "ts" : "js"}`);
    const existing = await this.github.getContent(owner, repo, filePath, base);
    const desired = buildInstrumentation(this.config.analyticsOrigin, site.siteId);
    const existingContent = existing?.content ? decodeContent(existing) : null;
    const homepage = await this.fetchImpl(`https://${site.hostname}/`, { method: "HEAD", redirect: "follow" }).catch(
      () => null
    );

    return {
      site,
      project,
      owner,
      repo,
      base,
      filePath,
      branch: `codex/agency-analytics-${site.siteId}`,
      installed: existingContent === desired,
      conflict: Boolean(existingContent && existingContent !== desired),
      cspCompatible: trackerCspCompatible(
        homepage?.headers.get("content-security-policy") ?? null,
        this.config.analyticsOrigin
      ),
      desired,
    };
  }

  private publicPlan(item: Inspection) {
    const reason = item.conflict
      ? `${item.filePath} already exists with different code`
      : !item.cspCompatible
        ? "The production Content Security Policy does not allow the analytics origin"
        : undefined;
    return {
      hostname: item.site.hostname,
      provider: "vercel" as const,
      supported: true,
      installed: item.installed,
      blocked: Boolean(reason),
      reason,
      project: item.project.name,
      repository: `${item.owner}/${item.repo}`,
      filePath: item.filePath,
      branch: item.branch,
    };
  }

  async plan(site: TrackingSite, projectName?: string) {
    return this.publicPlan(await this.inspect(site, projectName));
  }

  private async ensurePullRequest(item: Inspection) {
    const existingPullRequests = await this.github.listPullRequests(item.owner, item.repo, item.branch);
    if (existingPullRequests[0]) return existingPullRequests[0];

    let branch;
    try {
      branch = await this.github.getBranch(item.owner, item.repo, item.branch);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
    if (!branch) {
      const baseRef = await this.github.getBranch(item.owner, item.repo, item.base);
      await this.github.createBranch(item.owner, item.repo, item.branch, baseRef.object.sha);
    }
    const branchFile = await this.github.getContent(item.owner, item.repo, item.filePath, item.branch);
    if (!branchFile) {
      await this.github.putFile(item.owner, item.repo, item.filePath, item.branch, item.desired);
    } else if (decodeContent(branchFile) !== item.desired) {
      throw new Error(`${item.owner}/${item.repo}:${item.branch} already contains a different ${item.filePath}`);
    }
    return this.github.createPullRequest(item.owner, item.repo, {
      branch: item.branch,
      base: item.base,
      hostname: item.site.hostname,
      siteId: item.site.siteId,
      analyticsOrigin: this.config.analyticsOrigin,
    });
  }

  async apply(site: TrackingSite, projectName?: string) {
    const item = await this.inspect(site, projectName);
    const plan = this.publicPlan(item);
    if (plan.blocked) return plan;
    if (item.installed) return plan;
    const pullRequest = await this.ensurePullRequest(item);
    const deployment = await this.vercel.findBranchDeployment(item.project.id, item.branch);
    return {
      ...plan,
      pullRequestUrl: pullRequest.html_url,
      previewUrl: deployment?.url ? `https://${deployment.url}` : undefined,
      previewState: deployment?.readyState ?? "QUEUED",
    };
  }

  async status(site: TrackingSite, projectName?: string) {
    const item = await this.inspect(site, projectName);
    const pullRequests = await this.github.listPullRequests(item.owner, item.repo, item.branch);
    const deployment = await this.vercel.findBranchDeployment(item.project.id, item.branch);
    return {
      ...this.publicPlan(item),
      pullRequestUrl: pullRequests[0]?.html_url,
      previewUrl: deployment?.url ? `https://${deployment.url}` : undefined,
      previewState: deployment?.readyState ?? "NOT_FOUND",
    };
  }

  async rollback(site: TrackingSite, projectName?: string) {
    const item = await this.inspect(site, projectName);
    if (item.installed) {
      return {
        ...this.publicPlan(item),
        blocked: true,
        installed: true,
        reason: "Tracking is already on the production branch. Create a normal revert pull request instead.",
      };
    }
    const pullRequests = await this.github.listPullRequests(item.owner, item.repo, item.branch);
    for (const pullRequest of pullRequests) {
      await this.github.updatePullRequest(item.owner, item.repo, pullRequest.number, "closed");
    }
    try {
      await this.github.deleteBranch(item.owner, item.repo, item.branch);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 422) throw error;
    }
    return {
      ...this.publicPlan(item),
      installed: false,
      pullRequestUrl: undefined,
      previewUrl: undefined,
      previewState: "ROLLED_BACK",
      reason: "Preview pull request closed and managed branch removed",
    };
  }
}
