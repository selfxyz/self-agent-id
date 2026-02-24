import { AgentsTabs } from "@/components/AgentsTabs";

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen max-w-2xl mx-auto px-6 pt-24 pb-12">
      <AgentsTabs />
      {children}
    </main>
  );
}
