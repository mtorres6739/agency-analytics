#!/usr/bin/env node

import { buildWorker, CloudflareClient, loadManifest, parseArguments } from "./lib.mjs";

function printInspection(sites) {
  console.table(
    sites.map(site => ({
      hostname: site.hostname,
      siteId: site.siteId,
      zone: site.zoneName,
      proxied: site.proxied ? "yes" : "no",
      route: site.currentScript ?? site.inheritedRoute ?? "available",
      result: !site.proxied ? "BLOCKED: DNS not proxied" : site.conflict ? "BLOCKED: route conflict" : "ready",
    }))
  );
}

async function inspectAll(client, manifest, scriptName) {
  const sites = [];
  for (const site of manifest.sites) {
    const expectedScript = `${scriptName}-${site.siteId}`;
    sites.push({ ...(await client.inspectSite(site, expectedScript)), expectedScript });
  }
  return sites;
}

async function verify(manifest) {
  let failed = false;
  for (const site of manifest.sites) {
    const homepage = await fetch(`https://${site.hostname}/`, {
      headers: { accept: "text/html", "user-agent": "BoldAnalyticsInstaller/1.0" },
      redirect: "follow",
    });
    const html = await homepage.text();
    const scriptUrl = `https://${site.hostname}${manifest.pathPrefix}/script.js`;
    const script = await fetch(scriptUrl, { redirect: "follow" });
    const installed = html.includes(`${manifest.pathPrefix}/script.js`) && html.includes(`data-site-id="${site.siteId}"`);
    const proxied = script.ok && script.headers.get("x-bold-analytics-proxy") === "1";
    const passed = homepage.ok && installed && proxied;
    failed ||= !passed;
    console.log(`${passed ? "PASS" : "FAIL"} ${site.hostname} html=${homepage.status} injected=${installed} proxy=${proxied}`);
  }
  if (failed) process.exitCode = 1;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const manifest = await loadManifest(options.manifestPath);

  if (options.command === "verify") {
    await verify(manifest);
    return;
  }

  const client = new CloudflareClient({
    token: process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API,
    accountId: process.env.CF_ACCOUNT_ID,
  });
  const sites = await inspectAll(client, manifest, options.scriptName);
  printInspection(sites);

  if (options.command === "plan") {
    if (sites.some(site => !site.proxied || site.conflict)) process.exitCode = 1;
    return;
  }

  if (options.command === "rollback") {
    const installed = sites.filter(site => site.currentScript === site.expectedScript && site.routeId);
    for (const site of installed) {
      await client.deleteRoute(site);
      console.log(`Removed ${site.pattern}`);
    }
    console.log(`Rollback complete. Removed ${installed.length} route(s).`);
    return;
  }

  const blocked = sites.filter(site => !site.proxied || site.conflict);
  if (blocked.length) throw new Error("Apply blocked. Resolve unproxied DNS records or existing Worker route conflicts first.");

  const created = [];
  try {
    for (const site of sites) {
      const source = await buildWorker({ ...manifest, sites: [{ hostname: site.hostname, siteId: site.siteId }] });
      await client.uploadWorker(site.expectedScript, source);
      console.log(`Uploaded Worker ${site.expectedScript}`);
      if (!site.routeId) {
        const route = await client.createRoute(site, site.expectedScript);
        created.push({ ...site, routeId: route.id });
        console.log(`Attached ${site.pattern}`);
      }
    }
  } catch (error) {
    for (const site of created.reverse()) {
      await client.deleteRoute(site).catch(() => undefined);
    }
    throw new Error(`Route deployment failed and new routes were rolled back: ${error.message}`);
  }

  await verify(manifest);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
