import { describe, expect, it } from "vitest";
import { decideIdentityConsent } from "./consentPolicy.js";

describe("identity resolution consent policy", () => {
  it("allows an affirmative identification choice for US traffic", () => {
    expect(
      decideIdentityConsent({
        requested: true,
        headerGpc: false,
        clientGpc: false,
        categories: ["identification"],
        countryIso: "US",
      })
    ).toMatchObject({ granted: true, code: "GRANTED" });
  });

  it("lets either GPC signal override an affirmative choice", () => {
    expect(
      decideIdentityConsent({
        requested: true,
        headerGpc: true,
        clientGpc: false,
        categories: ["identification"],
        countryIso: "US",
      })
    ).toMatchObject({ granted: false, gpc: true, code: "GPC" });
  });

  it("fails closed outside the US and when geolocation is unavailable", () => {
    for (const countryIso of ["CA", null, undefined]) {
      expect(
        decideIdentityConsent({
          requested: true,
          headerGpc: false,
          clientGpc: false,
          categories: ["identification"],
          countryIso,
        })
      ).toMatchObject({ granted: false, eligibleRegion: false, code: "REGION_NOT_ELIGIBLE" });
    }
  });
});
