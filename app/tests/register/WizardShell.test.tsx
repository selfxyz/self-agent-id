import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/agents/register/steps/WhoAreYouStep", () => ({
  default: ({ onSelect }: any) => (
    <div>
      <button onClick={() => onSelect("human")}>Mock Human</button>
      <button onClick={() => onSelect("bot")}>Mock Bot</button>
    </div>
  ),
}));
vi.mock("@/app/agents/register/steps/ModeSelector", () => ({
  ModeSelector: ({ onSelect, onBack }: any) => (
    <div>
      <button onClick={() => onSelect("linked")}>Mock ModeSelector</button>
      <button onClick={onBack} data-testid="wizard-back">
        Mock Back
      </button>
    </div>
  ),
}));
vi.mock("@/components/Card", () => ({
  Card: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement("div", props, children),
}));

import { WizardShell } from "@/app/agents/register/WizardShell";

afterEach(cleanup);

describe("WizardShell", () => {
  it("starts on WhoAreYou step", () => {
    render(<WizardShell />);
    expect(screen.getByText("Mock Human")).toBeDefined();
  });

  it("advances to ModeSelector when human selected", () => {
    render(<WizardShell />);
    fireEvent.click(screen.getByText("Mock Human"));
    expect(screen.getByText("Mock ModeSelector")).toBeDefined();
  });

  it("shows bot info panel when bot selected", () => {
    render(<WizardShell />);
    fireEvent.click(screen.getByText("Mock Bot"));
    expect(screen.getByText(/register programmatically/i)).toBeDefined();
    expect(screen.getByText("CLI")).toBeDefined();
    expect(screen.getByText("REST API")).toBeDefined();
    expect(screen.getByText("A2A Protocol")).toBeDefined();
  });

  it("calls onWizardComplete when mode selected", () => {
    const onComplete = vi.fn();
    render(<WizardShell onWizardComplete={onComplete} />);
    fireEvent.click(screen.getByText("Mock Human"));
    fireEvent.click(screen.getByText("Mock ModeSelector"));
    expect(onComplete).toHaveBeenCalledWith({ role: "human", mode: "linked" });
  });

  it("back from bot info returns to who step", () => {
    render(<WizardShell />);
    fireEvent.click(screen.getByText("Mock Bot"));
    fireEvent.click(screen.getByTestId("wizard-back"));
    expect(screen.getByText("Mock Human")).toBeDefined();
  });

  it("back from mode step returns to who step", () => {
    render(<WizardShell />);
    fireEvent.click(screen.getByText("Mock Human"));
    fireEvent.click(screen.getByTestId("wizard-back"));
    expect(screen.getByText("Mock Human")).toBeDefined();
  });
});
