import { describe, expect, it, vi } from "vitest";
import { VercelIdentityProvisioner } from "./vercelIdentityProvisioner.js";

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe("VercelIdentityProvisioner", () => {
  it("installs server-only identity variables and redeploys production", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ projects: [{ id: "prj_1", name: "palm-squad" }], pagination: {} }))
      .mockResolvedValueOnce(response({ domains: [{ name: "www.palmsquad.com" }] }))
      .mockResolvedValueOnce(response({ deployments: [{ uid: "dpl_old", readyState: "READY" }] }))
      .mockResolvedValueOnce(response({ created: { id: "env_1" }, failed: [] }, true, 201))
      .mockResolvedValueOnce(response({ created: { id: "env_2" }, failed: [] }, true, 201))
      .mockResolvedValueOnce(response({ uid: "dpl_new", readyState: "QUEUED" }, true, 201));
    const provider = new VercelIdentityProvisioner("token", "team_1", fetchImpl);

    await expect(
      provider.provision({ hostname: "palmsquad.com", sitePublicId: "1191dcbdd5c0", secret: "secret-value" })
    ).resolves.toEqual({
      projectId: "prj_1",
      projectName: "palm-squad",
      deploymentId: "dpl_new",
    });

    const environmentCalls = fetchImpl.mock.calls.filter(([url]) => String(url).includes("/env?"));
    expect(environmentCalls).toHaveLength(2);
    expect(JSON.parse(String(environmentCalls[0][1]?.body))).toMatchObject({
      key: "RYBBIT_IDENTITY_SECRET",
      value: "secret-value",
      type: "encrypted",
      target: ["production", "preview"],
    });
    expect(JSON.parse(String(environmentCalls[1][1]?.body))).toMatchObject({
      key: "RYBBIT_SITE_ID",
      value: "1191dcbdd5c0",
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[5][1]?.body))).toEqual({
      name: "palm-squad",
      project: "prj_1",
      deploymentId: "dpl_old",
      target: "production",
    });
  });

  it.each([
    ["READY", "ready"],
    ["BUILDING", "pending"],
    ["ERROR", "failed"],
  ] as const)("maps deployment state %s to %s", async (readyState, expected) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ id: "dpl_1", readyState }));
    const provider = new VercelIdentityProvisioner("token", undefined, fetchImpl);
    await expect(provider.status("dpl_1")).resolves.toBe(expected);
  });
});
