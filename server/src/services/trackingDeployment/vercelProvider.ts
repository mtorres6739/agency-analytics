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
  baseContent: string | null;
  existingSha?: string;
  deploymentMode: "instrumentation-client" | "app-layout" | "static-html";
  additionalFiles: ManagedFile[];
};

type ManagedFile = {
  filePath: string;
  desired: string;
  baseContent: string | null;
  existingSha?: string;
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

  async findBranchDeployment(projectId: string, branch: string, commitSha?: string) {
    const query = new URLSearchParams({ projectId, limit: "20" });
    const payload = await this.request(this.scoped(`/v6/deployments?${query}`));
    return (
      payload.deployments?.find(
        (deployment: any) =>
          deployment.meta?.githubCommitRef === branch && (!commitSha || deployment.meta?.githubCommitSha === commitSha)
      ) ?? null
    );
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

  putFile(owner: string, repo: string, filePath: string, branch: string, content: string, sha?: string) {
    return this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(filePath)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: "feat: add Agency Analytics tracking",
          content: Buffer.from(content).toString("base64"),
          branch,
          ...(sha ? { sha } : {}),
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
    input: { branch: string; base: string; hostname: string; trackingId: string; analyticsOrigin: string }
  ) {
    return this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: "Add Agency Analytics tracking",
        head: input.branch,
        base: input.base,
        body: `Installs the managed Agency Analytics tracker for **${input.hostname}** (property ID \`${input.trackingId}\`).\n\nVercel will create a preview deployment. Verify a browser event in ${input.analyticsOrigin} before merging.`,
      }),
    });
  }

  updatePullRequest(owner: string, repo: string, number: number, state: "closed") {
    return this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`, {
      method: "PATCH",
      body: JSON.stringify({ state }),
    });
  }

  mergePullRequest(owner: string, repo: string, number: number) {
    return this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/merge`, {
      method: "PUT",
      body: JSON.stringify({ merge_method: "squash" }),
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

export function buildInstrumentation(analyticsOrigin: string, trackingId: string) {
  return `// Agency Analytics managed tracker. Changes are overwritten by the installer.\nconst existing = document.querySelector('script[data-agency-analytics="managed"]');\n\nif (!existing) {\n  const script = document.createElement("script");\n  script.src = "${analyticsOrigin}/api/script.js";\n  script.setAttribute("data-site-id", "${trackingId}");\n  script.setAttribute("data-agency-analytics", "managed");\n  script.defer = true;\n  document.head.appendChild(script);\n}\n`;
}

export function buildAppLayoutInstrumentation(source: string, analyticsOrigin: string, trackingId: string) {
  if (hasManagedInstrumentation(source, analyticsOrigin, trackingId)) return source;
  if (/data-agency-analytics\s*=/.test(source)) {
    throw new Error("The app layout already contains a different managed analytics tracker");
  }
  const body = source.match(/<body\b[\s\S]*?>/);
  if (!body?.index && body?.index !== 0) throw new Error("The Next.js app layout does not contain a body element");

  const quote = source.match(/from\s+(['"])/)?.[1] ?? '"';
  const importLine = `import Script from ${quote}next/script${quote};\n`;
  const withImport = /from\s+["']next\/script["']/.test(source) ? source : `${importLine}${source}`;
  const bodyAfterImport = withImport.match(/<body\b[\s\S]*?>/);
  if (!bodyAfterImport?.index && bodyAfterImport?.index !== 0) {
    throw new Error("The Next.js app layout does not contain a body element");
  }
  const insertionPoint = bodyAfterImport.index + bodyAfterImport[0].length;
  const tracker = `\n        <Script\n          src=${quote}${analyticsOrigin}/api/script.js${quote}\n          data-site-id=${quote}${trackingId}${quote}\n          data-agency-analytics=${quote}managed${quote}\n          strategy=${quote}afterInteractive${quote}\n        />`;
  return `${withImport.slice(0, insertionPoint)}${tracker}${withImport.slice(insertionPoint)}`;
}

export function buildStaticHtmlInstrumentation(source: string, analyticsOrigin: string, trackingId: string) {
  if (hasManagedInstrumentation(source, analyticsOrigin, trackingId)) return source;
  if (hasManagedMarker(source)) {
    throw new Error("The HTML entrypoint already contains a different managed analytics tracker");
  }
  const closingHead = source.match(/<\/head\s*>/i);
  if (!closingHead?.index && closingHead?.index !== 0) {
    throw new Error("The HTML entrypoint does not contain a closing head element");
  }
  const indentation = source.slice(0, closingHead.index).match(/(?:^|\n)([ \t]*)[^\n]*$/)?.[1] ?? "  ";
  const tracker = `${indentation}<script\n${indentation}  src="${analyticsOrigin}/api/script.js"\n${indentation}  data-site-id="${trackingId}"\n${indentation}  data-agency-analytics="managed"\n${indentation}  defer\n${indentation}></script>\n`;
  return `${source.slice(0, closingHead.index)}${tracker}${source.slice(closingHead.index)}`;
}

function directiveContainsOrigin(source: string, directive: string, analyticsOrigin: string) {
  return source.split(/\r?\n/).some(line => line.includes(directive) && line.includes(analyticsOrigin));
}

export function buildNextConfigCspAllowance(source: string, analyticsOrigin: string) {
  let next = source;
  for (const directive of ["script-src", "connect-src"]) {
    if (directiveContainsOrigin(next, directive, analyticsOrigin)) continue;
    const pattern = new RegExp(`(["'\\\`])(${directive}\\s+[^\\r\\n]*?)(\\1)(?=,|;|\\)|\\]|$)`, "m");
    next = next.replace(
      pattern,
      (_match, quote: string, value: string) => `${quote}${value} ${analyticsOrigin}${quote}`
    );
  }
  return next;
}

export function hasManagedInstrumentation(source: string, analyticsOrigin: string, trackingId: string) {
  const originPresent = source.includes(`${analyticsOrigin}/api/script.js`);
  const trackingIdPresent = source.includes(`"${trackingId}"`) || source.includes(`'${trackingId}'`);
  const markerPresent =
    source.includes('data-agency-analytics="managed"') ||
    source.includes("data-agency-analytics='managed'") ||
    /agencyAnalytics\s*=\s*["']managed["']/.test(source) ||
    /setAttribute\(\s*["']data-agency-analytics["']\s*,\s*["']managed["']\s*\)/.test(source);
  return originPresent && trackingIdPresent && markerPresent;
}

function hasManagedMarker(source: string) {
  return (
    /data-agency-analytics\s*=/.test(source) ||
    /setAttribute\(\s*["']data-agency-analytics["']/.test(source) ||
    /agencyAnalytics\s*=/.test(source)
  );
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

function addOriginToCspDirective(policy: string, directiveName: "script-src" | "connect-src", origin: string) {
  if (cspAllowsOrigin(policy, directiveName, origin)) return policy;

  const trailingSemicolon = policy.trimEnd().endsWith(";");
  const directives = policy
    .split(";")
    .map(value => value.trim())
    .filter(Boolean);
  const directiveIndex = directives.findIndex(value => value.split(/\s+/, 1)[0]?.toLowerCase() === directiveName);

  if (directiveIndex >= 0) {
    directives[directiveIndex] = `${directives[directiveIndex]} ${origin}`;
  } else {
    const defaultDirective = directives.find(value => value.split(/\s+/, 1)[0]?.toLowerCase() === "default-src");
    const inheritedSources = defaultDirective?.replace(/^default-src\s*/i, "").trim();
    directives.push(`${directiveName}${inheritedSources ? ` ${inheritedSources}` : ""} ${origin}`);
  }

  return `${directives.join("; ")}${trailingSemicolon ? ";" : ""}`;
}

function getVercelJsonCspPolicies(source: string) {
  const config = JSON.parse(source) as {
    headers?: Array<{ headers?: Array<{ key?: unknown; value?: unknown }> }>;
  };
  return (config.headers ?? []).flatMap(rule =>
    (rule.headers ?? [])
      .filter(header => String(header.key ?? "").toLowerCase() === "content-security-policy")
      .map(header => String(header.value ?? ""))
  );
}

function vercelJsonCspCompatible(source: string, analyticsOrigin: string) {
  const policies = getVercelJsonCspPolicies(source);
  return policies.length > 0 && policies.every(policy => trackerCspCompatible(policy, analyticsOrigin));
}

export function buildVercelJsonCspAllowance(source: string, analyticsOrigin: string) {
  // Validate the complete file before applying a minimal textual change. Keeping
  // the original formatting makes installer pull requests reviewable.
  const policies = getVercelJsonCspPolicies(source);
  if (policies.length === 0) return source;

  const headerPattern = /("key"\s*:\s*"content-security-policy"\s*,\s*"value"\s*:\s*)("(?:\\.|[^"\\])*")/gi;
  const desired = source.replace(headerPattern, (_match, prefix: string, encodedPolicy: string) => {
    const policy = JSON.parse(encodedPolicy) as string;
    const withScript = addOriginToCspDirective(policy, "script-src", analyticsOrigin);
    const withConnect = addOriginToCspDirective(withScript, "connect-src", analyticsOrigin);
    return `${prefix}${JSON.stringify(withConnect)}`;
  });

  return vercelJsonCspCompatible(desired, analyticsOrigin) ? desired : source;
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
    if (!project.framework || !["nextjs", "vite"].includes(project.framework)) {
      throw new Error(`${project.name} does not use a supported Next.js or Vite framework`);
    }
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
    let filePath: string;
    let existing: any;
    let existingContent: string | null;
    let desired: string;
    let deploymentMode: Inspection["deploymentMode"];

    if (project.framework === "vite") {
      filePath = joinPath(root, "index.html");
      existing = await this.github.getContent(owner, repo, filePath, base);
      if (!existing?.content) throw new Error(`${project.name} does not have a supported index.html entrypoint`);
      existingContent = decodeContent(existing);
      desired = buildStaticHtmlInstrumentation(existingContent, this.config.analyticsOrigin, site.trackingId);
      deploymentMode = "static-html";
    } else {
      const nextVersion = packageJson.dependencies?.next ?? packageJson.devDependencies?.next;
      const srcApp = await this.github.getContent(owner, repo, joinPath(root, "src", "app"), base);
      const srcPages = srcApp ? null : await this.github.getContent(owner, repo, joinPath(root, "src", "pages"), base);
      const sourceRoot = srcApp || srcPages ? "src" : "";
      const tsconfig = await this.github.getContent(owner, repo, joinPath(root, "tsconfig.json"), base);
      const useClientInstrumentation = supportsClientInstrumentation(nextVersion);

      if (useClientInstrumentation) {
        filePath = joinPath(root, sourceRoot, `instrumentation-client.${tsconfig ? "ts" : "js"}`);
        existing = await this.github.getContent(owner, repo, filePath, base);
        existingContent = existing?.content ? decodeContent(existing) : null;
        desired = buildInstrumentation(this.config.analyticsOrigin, site.trackingId);
        deploymentMode = "instrumentation-client";
      } else {
        if (!srcApp) {
          throw new Error(
            `${project.name} uses Next.js ${nextVersion ?? "unknown"}; automatic installation below 15.3 requires the App Router`
          );
        }
        const candidates = ["layout.tsx", "layout.jsx", "layout.ts", "layout.js"];
        let layout: any;
        filePath = "";
        for (const candidate of candidates) {
          const candidatePath = joinPath(root, sourceRoot, "app", candidate);
          layout = await this.github.getContent(owner, repo, candidatePath, base);
          if (layout?.content) {
            filePath = candidatePath;
            break;
          }
        }
        if (!layout?.content || !filePath)
          throw new Error(`${project.name} does not have a supported App Router layout`);
        existing = layout;
        existingContent = decodeContent(layout);
        desired = buildAppLayoutInstrumentation(existingContent, this.config.analyticsOrigin, site.trackingId);
        deploymentMode = "app-layout";
      }
    }
    const homepage = await this.fetchImpl(`https://${site.hostname}/`, { method: "HEAD", redirect: "follow" }).catch(
      () => null
    );
    const policy = homepage?.headers.get("content-security-policy") ?? null;
    let cspCompatible = trackerCspCompatible(policy, this.config.analyticsOrigin);
    const additionalFiles: ManagedFile[] = [];
    if (!cspCompatible) {
      const configPath = joinPath(root, "vercel.json");
      const configFile = await this.github.getContent(owner, repo, configPath, base);
      if (configFile?.content) {
        const baseContent = decodeContent(configFile);
        const desiredConfig = buildVercelJsonCspAllowance(baseContent, this.config.analyticsOrigin);
        if (desiredConfig !== baseContent && vercelJsonCspCompatible(desiredConfig, this.config.analyticsOrigin)) {
          additionalFiles.push({
            filePath: configPath,
            desired: desiredConfig,
            baseContent,
            existingSha: configFile.sha,
          });
          cspCompatible = true;
        }
      }
    }
    if (!cspCompatible && project.framework === "nextjs") {
      for (const candidate of ["next.config.ts", "next.config.mjs", "next.config.js"]) {
        const configPath = joinPath(root, candidate);
        const configFile = await this.github.getContent(owner, repo, configPath, base);
        if (!configFile?.content) continue;
        const baseContent = decodeContent(configFile);
        const desiredConfig = buildNextConfigCspAllowance(baseContent, this.config.analyticsOrigin);
        if (
          desiredConfig !== baseContent &&
          directiveContainsOrigin(desiredConfig, "script-src", this.config.analyticsOrigin) &&
          directiveContainsOrigin(desiredConfig, "connect-src", this.config.analyticsOrigin)
        ) {
          additionalFiles.push({
            filePath: configPath,
            desired: desiredConfig,
            baseContent,
            existingSha: configFile.sha,
          });
          cspCompatible = true;
        }
        break;
      }
    }

    return {
      site,
      project,
      owner,
      repo,
      base,
      filePath,
      branch: `codex/agency-analytics-${site.siteId}`,
      installed: Boolean(
        existingContent && hasManagedInstrumentation(existingContent, this.config.analyticsOrigin, site.trackingId)
      ),
      conflict: Boolean(
        existingContent &&
        (deploymentMode === "instrumentation-client" || hasManagedMarker(existingContent)) &&
        !hasManagedInstrumentation(existingContent, this.config.analyticsOrigin, site.trackingId)
      ),
      cspCompatible,
      desired,
      baseContent: existingContent,
      existingSha: existing?.sha,
      deploymentMode,
      additionalFiles,
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
      deploymentMode: item.deploymentMode,
      files: [item.filePath, ...item.additionalFiles.map(file => file.filePath)],
    };
  }

  async plan(site: TrackingSite, projectName?: string) {
    return this.publicPlan(await this.inspect(site, projectName));
  }

  private async putManagedFile(item: Inspection, file: ManagedFile) {
    const branchFile = await this.github.getContent(item.owner, item.repo, file.filePath, item.branch);
    if (!branchFile) {
      await this.github.putFile(item.owner, item.repo, file.filePath, item.branch, file.desired);
      return;
    }
    const branchContent = decodeContent(branchFile);
    if (branchContent === file.desired) return;
    if (file.baseContent !== null && branchContent === file.baseContent) {
      await this.github.putFile(item.owner, item.repo, file.filePath, item.branch, file.desired, branchFile.sha);
      return;
    }
    throw new Error(`${item.owner}/${item.repo}:${item.branch} already contains a different ${file.filePath}`);
  }

  private async ensurePullRequest(item: Inspection) {
    const existingPullRequests = await this.github.listPullRequests(item.owner, item.repo, item.branch);

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
    await this.putManagedFile(item, {
      filePath: item.filePath,
      desired: item.desired,
      baseContent: item.baseContent,
      existingSha: item.existingSha,
    });
    for (const file of item.additionalFiles) await this.putManagedFile(item, file);
    if (existingPullRequests[0]) {
      const refreshed = await this.github.listPullRequests(item.owner, item.repo, item.branch);
      return refreshed[0];
    }
    return this.github.createPullRequest(item.owner, item.repo, {
      branch: item.branch,
      base: item.base,
      hostname: item.site.hostname,
      trackingId: item.site.trackingId,
      analyticsOrigin: this.config.analyticsOrigin,
    });
  }

  private async waitForReadyPreview(projectId: string, branch: string, commitSha?: string) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const deployment = await this.vercel.findBranchDeployment(projectId, branch, commitSha);
      if (deployment?.readyState === "READY") return deployment;
      if (["ERROR", "CANCELED"].includes(deployment?.readyState)) {
        throw new Error(`The Vercel preview finished with ${deployment.readyState}`);
      }
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }
    throw new Error("The Vercel preview did not become ready within five minutes");
  }

  async apply(site: TrackingSite, projectName?: string, options: { autoMerge?: boolean } = {}) {
    const item = await this.inspect(site, projectName);
    const plan = this.publicPlan(item);
    if (plan.blocked) return plan;
    if (item.installed) return plan;
    const pullRequest = await this.ensurePullRequest(item);
    const deployment = options.autoMerge
      ? await this.waitForReadyPreview(item.project.id, item.branch, pullRequest.head?.sha)
      : await this.vercel.findBranchDeployment(item.project.id, item.branch);
    let merge: any;
    if (options.autoMerge) {
      merge = await this.github.mergePullRequest(item.owner, item.repo, pullRequest.number);
      if (!merge?.merged) throw new Error(merge?.message || "GitHub did not merge the tracking pull request");
    }
    return {
      ...plan,
      installed: options.autoMerge ? true : plan.installed,
      pullRequestUrl: pullRequest.html_url,
      previewUrl: deployment?.url ? `https://${deployment.url}` : undefined,
      previewState: deployment?.readyState ?? "QUEUED",
      autoMerged: options.autoMerge === true,
      mergeCommitSha: merge?.sha,
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
