import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mockSetNetworkId = vi.fn();
vi.mock("@/lib/NetworkContext", () => ({
  useNetwork: () => ({
    networkId: "celo-mainnet",
    setNetworkId: mockSetNetworkId,
  }),
}));

vi.mock("@/components/Button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement("button", props, children),
}));

import NetworkStep from "@/app/agents/register/steps/NetworkStep";

afterEach(() => {
  cleanup();
  mockSetNetworkId.mockClear();
});

describe("NetworkStep", () => {
  it("shows mainnet as default with real passport text", () => {
    render(<NetworkStep onContinue={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText("Celo Mainnet")).toBeDefined();
    expect(screen.getByText("default")).toBeDefined();
    expect(
      screen.getByText(/production-grade verified identity/),
    ).toBeDefined();
  });

  it("shows testnet option with mock documents text", () => {
    render(<NetworkStep onContinue={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText("Celo Sepolia (Testnet)")).toBeDefined();
    expect(screen.getByText(/mock documents/)).toBeDefined();
  });

  it("calls onContinue when Continue clicked", () => {
    const onContinue = vi.fn();
    render(<NetworkStep onContinue={onContinue} onBack={vi.fn()} />);

    fireEvent.click(screen.getByText("Continue"));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("does not render its own Back button (WizardShell provides it)", () => {
    render(<NetworkStep onContinue={vi.fn()} onBack={vi.fn()} />);

    // NetworkStep should not have a Back button — WizardShell handles back navigation
    expect(screen.queryByText("Back")).toBeNull();
  });

  it("calls setNetworkId when testnet card is clicked", () => {
    render(<NetworkStep onContinue={vi.fn()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByText("Celo Sepolia (Testnet)"));
    expect(mockSetNetworkId).toHaveBeenCalledWith("celo-sepolia");
  });
});
