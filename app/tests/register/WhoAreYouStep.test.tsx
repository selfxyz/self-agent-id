import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/Card", () => ({
  Card: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement("div", props, children),
}));

import WhoAreYouStep from "@/app/agents/register/steps/WhoAreYouStep";

afterEach(cleanup);

describe("WhoAreYouStep", () => {
  it("renders human and bot options", () => {
    render(<WhoAreYouStep onSelect={vi.fn()} />);
    expect(screen.getByText(/I'm a human/)).toBeDefined();
    expect(screen.getByText(/I'm a bot/)).toBeDefined();
  });

  it("calls onSelect with 'human' when human card clicked", () => {
    const onSelect = vi.fn();
    render(<WhoAreYouStep onSelect={onSelect} />);
    fireEvent.click(screen.getByText(/I'm a human/));
    expect(onSelect).toHaveBeenCalledWith("human");
  });

  it("calls onSelect with 'bot' when bot card clicked", () => {
    const onSelect = vi.fn();
    render(<WhoAreYouStep onSelect={onSelect} />);
    fireEvent.click(screen.getByText(/I'm a bot/));
    expect(onSelect).toHaveBeenCalledWith("bot");
  });
});
