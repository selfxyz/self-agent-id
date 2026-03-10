import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/privy", () => ({
  isPrivyConfigured: () => true,
}));
vi.mock("@/lib/aa", () => ({
  isPasskeySupported: () => Promise.resolve(true),
}));
vi.mock("@/components/Card", () => ({
  Card: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement("div", props, children),
}));
vi.mock("@/components/Badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) =>
    React.createElement("span", null, children),
}));
vi.mock("@/components/PrivyIcon", () => ({
  PrivyIcon: () => React.createElement("span", null, "Privy"),
}));

import { ModeSelector } from "@/app/agents/register/steps/ModeSelector";

afterEach(cleanup);

describe("ModeSelector", () => {
  const defaultProps = {
    role: "human" as const,
    onSelect: vi.fn(),
    onBack: vi.fn(),
  };

  // Q2: Ed25519 question
  it("starts with Ed25519 question", () => {
    render(<ModeSelector {...defaultProps} />);
    expect(screen.getByText(/does your agent already have signing keys/i)).toBeDefined();
    expect(screen.getByTestId("ed25519-yes")).toBeDefined();
    expect(screen.getByTestId("ed25519-no")).toBeDefined();
  });

  // Ed25519 Yes → Guardian question
  it("shows guardian question when Ed25519 yes", () => {
    render(<ModeSelector {...defaultProps} />);
    fireEvent.click(screen.getByTestId("ed25519-yes"));
    expect(screen.getByTestId("guardian-yes")).toBeDefined();
    expect(screen.getByTestId("guardian-no")).toBeDefined();
  });

  it("selects ed25519-linked when Ed25519 + guardian yes", () => {
    const onSelect = vi.fn();
    render(<ModeSelector {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("ed25519-yes"));
    fireEvent.click(screen.getByTestId("guardian-yes"));
    expect(onSelect).toHaveBeenCalledWith("ed25519-linked");
  });

  it("selects ed25519 when Ed25519 + guardian no", () => {
    const onSelect = vi.fn();
    render(<ModeSelector {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("ed25519-yes"));
    fireEvent.click(screen.getByTestId("guardian-no"));
    expect(onSelect).toHaveBeenCalledWith("ed25519");
  });

  // Ed25519 No → Security method question
  it("shows security options when Ed25519 no", () => {
    render(<ModeSelector {...defaultProps} />);
    fireEvent.click(screen.getByTestId("ed25519-no"));
    expect(screen.getByText(/how do you want to secure/i)).toBeDefined();
    expect(screen.getByTestId("secure-wallet")).toBeDefined();
    expect(screen.getByTestId("secure-passkey")).toBeDefined();
    expect(screen.getByTestId("secure-privy")).toBeDefined();
    expect(screen.getByTestId("secure-quickstart")).toBeDefined();
  });

  it("selects linked when wallet chosen", () => {
    const onSelect = vi.fn();
    render(<ModeSelector {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("ed25519-no"));
    fireEvent.click(screen.getByTestId("secure-wallet"));
    expect(onSelect).toHaveBeenCalledWith("linked");
  });

  it("selects smartwallet when passkey chosen", () => {
    const onSelect = vi.fn();
    render(<ModeSelector {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("ed25519-no"));
    fireEvent.click(screen.getByTestId("secure-passkey"));
    expect(onSelect).toHaveBeenCalledWith("smartwallet");
  });

  it("selects privy when social login chosen", () => {
    const onSelect = vi.fn();
    render(<ModeSelector {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("ed25519-no"));
    fireEvent.click(screen.getByTestId("secure-privy"));
    expect(onSelect).toHaveBeenCalledWith("privy");
  });

  it("selects walletfree when quick start chosen", () => {
    const onSelect = vi.fn();
    render(<ModeSelector {...defaultProps} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("ed25519-no"));
    fireEvent.click(screen.getByTestId("secure-quickstart"));
    expect(onSelect).toHaveBeenCalledWith("walletfree");
  });

  // Show all options
  it("shows comparison table when toggle clicked", () => {
    render(<ModeSelector {...defaultProps} />);
    fireEvent.click(screen.getByTestId("show-all-toggle"));
    expect(screen.getByTestId("comparison-table")).toBeDefined();
    expect(screen.getByTestId("table-row-linked")).toBeDefined();
    expect(screen.getByTestId("table-row-walletfree")).toBeDefined();
    expect(screen.getByTestId("table-row-ed25519")).toBeDefined();
  });
});
