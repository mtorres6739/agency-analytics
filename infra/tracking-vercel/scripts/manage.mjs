#!/usr/bin/env node

import {
  buildInstrumentation,
  decodeContent,
  GitHubClient,
  loadManifest,
  parseArguments,
  supportsClientInstrumentation,
  trackerCspCompatible,
  VercelClient,
} from "./lib.mjs";

function joinPath(...parts) {
  return parts.filter(Boolean).join("/").replaceAll("//", "/");
}

function branchName(site) {
  return `codex/agency-analytics-${site.siteId}`;
}

async function inspectSite(site, manifest, vercel, github) {
  const project = await vercel.getProject(site.vercelProject);
  if (project.framework !== "nextjs") throw new Error(`${site.vercelProject} is not a Next.js project`);
  if (project.link?.type !== "github" || !project.link.org || !project.link.repo) {
    throw new Error(`${site.vercelProject} is not connected to a GitHub repository`);
  }

  const owner = project.link.org;
  const repo = project.link.repo;
  const base = project.link.productionBranch || "main";
  const root = project.rootDirectory && project.rootDirectory !== "." ? project.rootDirectory : "";
  const packageItem = await github.getContent(owner, repo, joinPath(root, "package.json"), base);
  if (!packageItem?.content) throw new Error(`package.json not found for ${site.vercelProject}`);
  const packageJson = JSON.parse(decodeContent(packageItem));
  const nextVersion = packageJson.dependencies?.next ?? packageJson.devDependencies?.next;
  if (!supportsClientInstrumentation(nextVersion)) {
    throw new Error(`${site.vercelProject} uses Next.js ${nextVersion ?? "unknown"}; automatic installation requires 15.3+`);
  }

  const srcApp = await github.getContent(owner, repo, joinPath(root, "src", "app"), base);
  const srcPages = srcApp ? null : await github.getContent(owner, repo, joinPath(root, "src", "pages"), base);
  const sourceRoot = srcApp || srcPages ? "src" : "";
  const tsconfig = await github.getContent(owner, repo, joinPath(root, "tsconfig.json"), base);
  const extension = tsconfig ? "ts" : "js";
  const filePath = joinPath(root, sourceRoot, `instrumentation-client.${extension}`);
  const existing = await github.getContent(owner, repo, filePath, base);
  const desired = buildInstrumentation({ analyticsOrigin: manifest.analyticsOrigin, siteId: site.siteId });
  const existingContent = existing?.content ? decodeContent(existing) : null;
  const installed = existingContent === desired;
  const conflict = Boolean(existingContent && !installed);

  const homepage = await fetch(`https://${site.hostname}/`, { method: "HEAD", redirect: "follow" }).catch(() => null);
  const csp = homepage?.headers.get("content-security-policy") ?? null;
  const cspCompatible = trackerCspCompatible(csp, manifest.analyticsOrigin);

  return {
    site,
    project,
    owner,
    repo,
    base,
    filePath,
    branch: branchName(site),
    installed,
    conflict,
    cspCompatible,
    desired,
  };
}

function printPlan(items) {
  console.table(
    items.map(item => ({
      project: item.site.vercelProject,
      hostname: item.site.hostname,
      repository: `${item.owner}/${item.repo}`,
      file: item.filePath,
      CSP: item.cspCompatible ? "compatible" : "BLOCKED",
      result: item.installed ? "installed" : item.conflict ? "BLOCKED: file exists" : "ready for PR",
    }))
  );
}

async function ensurePullRequest(item, github) {
  const existingPrs = await github.listPullRequests(item.owner, item.repo, item.branch);
  if (existingPrs[0]) return existingPrs[0];

  let branch;
  try {
    branch = await github.getBranch(item.owner, item.repo, item.branch);
  } catch (error) {
    if (error.message !== "Not Found") throw error;
  }
  if (!branch) {
    const baseRef = await github.getBranch(item.owner, item.repo, item.base);
    await github.createBranch(item.owner, item.repo, item.branch, baseRef.object.sha);
  }
  const branchFile = await github.getContent(item.owner, item.repo, item.filePath, item.branch);
  if (!branchFile) {
    await github.putFile(item.owner, item.repo, item.filePath, item.branch, item.desired);
  } else if (decodeContent(branchFile) !== item.desired) {
    throw new Error(`${item.owner}/${item.repo}:${item.branch} already contains a different ${item.filePath}`);
  }
  return github.createPullRequest(item.owner, item.repo, {
    branch: item.branch,
    base: item.base,
    hostname: item.site.hostname,
    siteId: item.site.siteId,
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = await loadManifest(options.manifestPath);
  const vercel = new VercelClient(process.env.VERCEL_TOKEN);
  const github = new GitHubClient(process.env.GITHUB_TOKEN);
  const items = [];
  for (const site of manifest.sites) items.push(await inspectSite(site, manifest, vercel, github));
  printPlan(items);

  if (options.command === "plan") {
    if (items.some(item => item.conflict || !item.cspCompatible)) process.exitCode = 1;
    return;
  }

  if (options.command === "apply") {
    if (items.some(item => item.conflict || !item.cspCompatible)) {
      throw new Error("Apply blocked by an existing instrumentation file or incompatible Content Security Policy");
    }
    for (const item of items.filter(value => !value.installed)) {
      const pr = await ensurePullRequest(item, github);
      console.log(`Created or reused preview PR: ${pr.html_url}`);
    }
    return;
  }

  if (options.command === "status") {
    for (const item of items) {
      const prs = await github.listPullRequests(item.owner, item.repo, item.branch);
      const deployment = await vercel.findBranchDeployment(item.project.id, item.branch);
      console.log(
        `${item.site.hostname} PR=${prs[0]?.html_url ?? "none"} deployment=${deployment?.readyState ?? "not found"} url=${deployment?.url ? `https://${deployment.url}` : "none"}`
      );
    }
    return;
  }

  for (const item of items) {
    const prs = await github.listPullRequests(item.owner, item.repo, item.branch);
    for (const pr of prs) await github.updatePullRequest(item.owner, item.repo, pr.number, "closed");
    try {
      await github.deleteBranch(item.owner, item.repo, item.branch);
      console.log(`Closed preview PR and removed ${item.owner}/${item.repo}:${item.branch}`);
    } catch (error) {
      if (error.message !== "Reference does not exist") throw error;
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
