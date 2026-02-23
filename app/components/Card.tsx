import { ReactNode } from "react";

const variantBorder: Record<string, string> = {
  default: "",
  warn: "border-l-2 border-l-accent-warn",
  success: "border-l-2 border-l-accent-success",
  error: "border-l-2 border-l-accent-error",
};

interface CardProps {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  variant?: "default" | "warn" | "success" | "error";
}

export function Card({
  children,
  className = "",
  glow = false,
  variant = "default",
}: CardProps) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface-1 p-6 shadow-sm ${
        glow ? "hover:shadow-md hover:border-border-strong transition-all" : ""
      } ${variantBorder[variant]} ${className}`}
    >
      {children}
    </div>
  );
}
