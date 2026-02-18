const colors: Record<string, string> = {
  verified: "bg-accent-success",
  revoked: "bg-accent-error",
  pending: "bg-accent-warn",
};

interface StatusDotProps {
  status: keyof typeof colors;
  className?: string;
}

export function StatusDot({ status, className = "" }: StatusDotProps) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${colors[status]} ${className}`}
    />
  );
}
