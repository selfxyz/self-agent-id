# Docs Review Prompt (Coworker)

Use this prompt to review and improve the recent documentation migration.

---

Please review the following docs changes for correctness, clarity, and missing guidance:

1. `README.md`
2. `docs/SELF_PROTOCOL_INTEGRATION.md`
3. `docs/CLI_REGISTRATION_GUIDE.md`
4. `docs/WORKSHOP_IMPLEMENTATION_HANDOFF.md`

Review goals:

1. Confirm technical correctness of verifier behavior:
   - registered-key prerequisite
   - network mismatch failure mode
   - raw-body verification fidelity
   - replay/timestamp/tamper drill expectations
2. Confirm operational usefulness:
   - can an engineer run the smoke checklist without ambiguity?
   - are failure outcomes specific and actionable?
3. Confirm consistency:
   - terminology matches SDK/API naming
   - defaults and caveats are consistent across docs
4. Identify gaps:
   - what important troubleshooting cases are still missing?
   - what sections are too verbose or too shallow?

Requested output format:

1. **Findings first** (high -> medium -> low severity), with file references.
2. **Suggested edits** (concrete wording or section changes).
3. **Open questions** requiring product/security decisions.
4. **Go/No-Go** recommendation for workshop-facing documentation.

Please be critical and specific; prioritize preventing onboarding and demo-time failures.
