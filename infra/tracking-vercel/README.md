# Vercel tracking installer

This installer discovers a Vercel project's connected GitHub repository, confirms the project runs Next.js 15.3 or newer, and opens a narrowly scoped tracking PR. Vercel then creates its normal preview deployment from the branch.

It uses Next.js `instrumentation-client.ts|js`, a first-class analytics/monitoring entrypoint that runs before hydration. This avoids framework-specific edits to a root layout and keeps the change to one managed file.

## Safety model

- Every production hostname, Rybbit site ID, and Vercel project must be explicitly mapped.
- `plan` discovers the repository, production branch, monorepo root, `src` layout, Next.js version, existing instrumentation, and production CSP.
- Existing `instrumentation-client` files are never overwritten.
- A restrictive CSP blocks apply instead of creating a tracker that the browser will reject.
- `apply` creates a `codex/agency-analytics-<siteId>` branch and PR. It does not merge or promote production.
- Vercel supplies the preview deployment automatically through the existing Git integration.
- `rollback` closes the unmerged PR and removes only the installer branch.
- After merge, rollback is a normal revert PR so production history remains auditable.

## Use

The workstation must already be authenticated with `vercel login` and `gh auth login`. Their tokens are loaded into the process without being printed.

```bash
cd infra/tracking-vercel
cp site-manifest.example.json site-manifest.json
# Replace all example values with one exact Rybbit/Vercel mapping.
npm test
npm run plan
npm run apply
npm run status
```

Open the reported Vercel preview in a browser, confirm the tracker loads, and use **Verify** on the Agency Analytics client page. Merge only after the browser event appears. Vercel will then deploy the production branch normally.

Cancel an unmerged installation with:

```bash
npm run rollback
```

## Limits

- Automatic source installation currently targets Next.js 15.3+ projects. Older Next.js projects and non-Next frameworks need a reviewed framework-specific adapter.
- A repository with an existing `instrumentation-client` file needs a manual, additive patch.
- Tokens remain local and server-side. The generated tracker contains only the public analytics origin and numeric site ID.
