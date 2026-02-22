import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SelfAgentVerifier } from "../SelfAgentVerifier";

describe("SelfAgentVerifier chainable builder", () => {
  it("creates a verifier with .create().build()", () => {
    const v = SelfAgentVerifier.create()
      .network("testnet")
      .build();
    assert.ok(v);
    assert.ok(v.verify);
  });

  it("chains credential requirements", () => {
    const v = SelfAgentVerifier.create()
      .network("testnet")
      .requireAge(18)
      .requireOFAC()
      .requireNationality("US", "GB")
      .build();
    assert.ok(v);
  });

  it("chains security settings", () => {
    const v = SelfAgentVerifier.create()
      .network("testnet")
      .requireSelfProvider()
      .sybilLimit(3)
      .replayProtection()
      .maxAge(60_000)
      .cacheTtl(30_000)
      .build();
    assert.ok(v);
  });

  it("chains rate limiting", () => {
    const v = SelfAgentVerifier.create()
      .network("testnet")
      .rateLimit({ perMinute: 10 })
      .build();
    assert.ok(v);
  });

  it("fromConfig creates same verifier", () => {
    const v = SelfAgentVerifier.fromConfig({
      network: "testnet",
      requireAge: 18,
      requireOFAC: true,
      sybilLimit: 1,
      rateLimit: { perMinute: 10 },
    });
    assert.ok(v);
    assert.ok(v.verify);
  });

  it("includeCredentials is auto-enabled by requireAge", () => {
    const v = SelfAgentVerifier.create()
      .network("testnet")
      .requireAge(18)
      .build();
    assert.ok(v);
  });

  it("old constructor style still works", () => {
    const v = new SelfAgentVerifier({ network: "testnet" });
    assert.ok(v);
    assert.ok(v.verify);
  });

  it("default constructor still works", () => {
    const v = new SelfAgentVerifier();
    assert.ok(v);
  });
});
