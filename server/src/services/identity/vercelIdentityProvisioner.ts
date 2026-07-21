type Fetch = typeof fetch;

type VercelProject = {
  id: string;
  name: string;
};

type VercelDeployment = {
  id?: string;
  uid?: string;
  url?: string;
  readyState?: string;
  status?: string;
};

export type IdentityDeploymentState = "pending" | "ready" | "failed";

class VercelIdentityError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

export class VercelIdentityProvisioner {
  constructor(
    private readonly token: string,
    private readonly teamId?: string,
    private readonly fetchImpl: Fetch = fetch
  ) {}

  private scoped(pathname: string) {
    if (!this.teamId) return pathname;
    const url = new URL(pathname, "https://api.vercel.com");
    url.searchParams.set("teamId", this.teamId);
    return `${url.pathname}${url.search}`;
  }

  private async request(pathname: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.token}`);
    headers.set("accept", "application/json");
    headers.set("user-agent", "AgencyAnalyticsIdentity/1.0");
    if (init.body) headers.set("content-type", "application/json");
    const response = await this.fetchImpl(`https://api.vercel.com${this.scoped(pathname)}`, {
      ...init,
      headers,
    });
    const payload = (await response.json().catch(() => null)) as any;
    if (!response.ok) {
      throw new VercelIdentityError(
        payload?.error?.message || payload?.message || `Vercel request failed with HTTP ${response.status}`,
        response.status
      );
    }
    return payload;
  }

  private async findProjectByDomain(hostname: string): Promise<VercelProject | null> {
    const normalized = hostname.toLowerCase().replace(/^www\./, "");
    let until: string | undefined;
    do {
      const query = new URLSearchParams({ limit: "100" });
      if (until) query.set("until", until);
      const payload = await this.request(`/v9/projects?${query}`);
      const projects = (payload.projects ?? []) as VercelProject[];
      for (const project of projects) {
        const domains = await this.request(`/v9/projects/${encodeURIComponent(project.id)}/domains?limit=100`);
        const matched = (domains.domains ?? []).some((domain: { name?: string }) => {
          const value = String(domain.name ?? "")
            .toLowerCase()
            .replace(/^www\./, "");
          return value === normalized;
        });
        if (matched) return project;
      }
      until = payload.pagination?.next ? String(payload.pagination.next) : undefined;
    } while (until);
    return null;
  }

  private async upsertEnvironment(projectId: string, key: string, value: string) {
    const response = await this.request(`/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true`, {
      method: "POST",
      body: JSON.stringify({
        key,
        value,
        type: "encrypted",
        target: ["production", "preview"],
        comment: "Managed by SDM Agency Analytics verified identity",
      }),
    });
    if (Array.isArray(response.failed) && response.failed.length > 0) {
      throw new VercelIdentityError("Vercel rejected a managed identity environment variable");
    }
  }

  private async latestProductionDeployment(projectId: string): Promise<VercelDeployment | null> {
    const query = new URLSearchParams({
      projectId,
      target: "production",
      state: "READY",
      limit: "1",
    });
    const payload = await this.request(`/v6/deployments?${query}`);
    return payload.deployments?.[0] ?? null;
  }

  async provision(input: { hostname: string; sitePublicId: string; secret: string }) {
    const project = await this.findProjectByDomain(input.hostname);
    if (!project) {
      throw new VercelIdentityError(`No supported Vercel project contains ${input.hostname}`, 404);
    }
    const priorDeployment = await this.latestProductionDeployment(project.id);
    if (!priorDeployment) {
      throw new VercelIdentityError(`No ready production deployment exists for ${input.hostname}`, 409);
    }
    const priorDeploymentId = priorDeployment.id ?? priorDeployment.uid;
    if (!priorDeploymentId) {
      throw new VercelIdentityError(`Vercel did not return a production deployment ID for ${input.hostname}`, 502);
    }

    await this.upsertEnvironment(project.id, "RYBBIT_IDENTITY_SECRET", input.secret);
    await this.upsertEnvironment(project.id, "RYBBIT_SITE_ID", input.sitePublicId);

    const deployment = (await this.request("/v13/deployments", {
      method: "POST",
      body: JSON.stringify({
        name: project.name,
        project: project.id,
        deploymentId: priorDeploymentId,
        target: "production",
      }),
    })) as VercelDeployment;
    const deploymentId = deployment.id ?? deployment.uid;
    if (!deploymentId) throw new VercelIdentityError("Vercel did not return a deployment ID");
    return { projectId: project.id, projectName: project.name, deploymentId };
  }

  async status(deploymentId: string): Promise<IdentityDeploymentState> {
    const deployment = (await this.request(`/v13/deployments/${encodeURIComponent(deploymentId)}`)) as VercelDeployment;
    const state = String(deployment.readyState ?? deployment.status ?? "").toUpperCase();
    if (state === "READY") return "ready";
    if (["ERROR", "CANCELED", "FAILED", "BLOCKED"].includes(state)) return "failed";
    return "pending";
  }
}

export function createVercelIdentityProvisioner() {
  const token = process.env.VERCEL_TOKEN?.trim();
  if (!token) return null;
  return new VercelIdentityProvisioner(token, process.env.VERCEL_TEAM_ID?.trim() || undefined);
}
