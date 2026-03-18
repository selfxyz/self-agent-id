"use client";

import type { Disclosures } from "../hooks/useRegistrationState";

interface DisclosuresSectionProps {
  disclosures: Disclosures;
  onUpdate: <K extends keyof Disclosures>(
    key: K,
    value: Disclosures[K],
  ) => void;
}

const AGE_OPTIONS: { label: string; value: Disclosures["minimumAge"] }[] = [
  { label: "None", value: 0 },
  { label: "18+", value: 18 },
  { label: "21+", value: 21 },
];

const OPTIONAL_FIELDS: { key: keyof Disclosures; label: string }[] = [
  { key: "nationality", label: "Nationality" },
  { key: "name", label: "Name" },
  { key: "date_of_birth", label: "Date of birth" },
  { key: "gender", label: "Gender" },
  { key: "issuing_state", label: "Issuing state" },
];

export function DisclosuresSection({
  disclosures,
  onUpdate,
}: DisclosuresSectionProps) {
  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold text-foreground">Disclosures</h2>

      <div className="space-y-3">
        <div>
          <label className="block text-sm text-muted mb-1">
            Age requirement
          </label>
          <select
            value={disclosures.minimumAge}
            onChange={(e) =>
              onUpdate(
                "minimumAge",
                Number(e.target.value) as Disclosures["minimumAge"],
              )
            }
            className="w-full px-3 py-2 text-sm rounded-lg"
          >
            {AGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={disclosures.ofac}
            onChange={(e) => onUpdate("ofac", e.target.checked)}
            className="h-4 w-4 rounded border-border accent-accent"
          />
          <span className="text-sm text-foreground">OFAC screening</span>
        </label>
      </div>

      <div className="space-y-3">
        <p className="text-sm text-muted">Also disclose:</p>
        {OPTIONAL_FIELDS.map((field) => (
          <label
            key={field.key}
            className="flex items-center gap-3 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={disclosures[field.key] as boolean}
              onChange={(e) => onUpdate(field.key, e.target.checked)}
              className="h-4 w-4 rounded border-border accent-accent"
            />
            <span className="text-sm text-foreground">{field.label}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
