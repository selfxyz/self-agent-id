"use client";

import React from "react";
import { User, Bot, Terminal, Globe, MessageSquare } from "lucide-react";
import { Card } from "@/components/Card";
import type { UserRole } from "../types";

interface WhoAreYouStepProps {
  onSelect: (role: UserRole) => void;
}

export default function WhoAreYouStep({ onSelect }: WhoAreYouStepProps) {
  return (
    <div className="space-y-6">
      <p className="text-muted text-sm text-center">
        Let&apos;s get your agent a verified identity. Who&apos;s registering?
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Human card */}
        <button
          type="button"
          className="rounded-xl border-2 border-border hover:border-accent p-5 text-left transition-colors cursor-pointer"
          onClick={() => onSelect("human")}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20">
              <User className="h-5 w-5 text-accent" />
            </div>
            <span className="font-bold text-sm">I&apos;m a human</span>
          </div>
          <p className="text-muted text-xs">
            I want to register an agent using the guided wizard. I&apos;ll
            verify my identity with my passport via the Self app.
          </p>
        </button>

        {/* Bot card */}
        <button
          type="button"
          className="rounded-xl border-2 border-border hover:border-accent p-5 text-left transition-colors cursor-pointer"
          onClick={() => onSelect("bot")}
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20">
              <Bot className="h-5 w-5 text-accent" />
            </div>
            <span className="font-bold text-sm">I&apos;m a bot / agent</span>
          </div>
          <p className="text-muted text-xs">
            I need to register programmatically via API, CLI, or A2A protocol.
          </p>
        </button>
      </div>
    </div>
  );
}
