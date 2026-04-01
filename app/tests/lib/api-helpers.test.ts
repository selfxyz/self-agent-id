import { describe, expect, it } from "vitest";
import {
  validateAgentId,
  corsResponse,
  errorResponse,
  CORS_HEADERS,
} from "@/lib/api-helpers";

describe("validateAgentId", () => {
  it("returns bigint for valid positive id", () => {
    expect(validateAgentId("42")).toBe(42n);
  });

  it("returns null for zero", () => {
    expect(validateAgentId("0")).toBeNull();
  });

  it("returns null for negative", () => {
    expect(validateAgentId("-1")).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(validateAgentId("abc")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(validateAgentId("")).toBeNull();
  });
});

describe("corsResponse", () => {
  it("returns 204 with CORS headers", () => {
    const res = corsResponse();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe(
      "GET, POST, OPTIONS",
    );
    expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
  });
});

describe("errorResponse", () => {
  it("returns correct status and JSON envelope", async () => {
    const res = errorResponse("Not found", 404);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Not found" });
  });

  it("includes CORS headers", () => {
    const res = errorResponse("fail", 500);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("CORS_HEADERS", () => {
  it("has expected shape", () => {
    expect(CORS_HEADERS).toEqual({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
    });
  });
});
