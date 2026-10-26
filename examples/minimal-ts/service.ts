// SPDX-License-Identifier: MIT

/**
 * Minimal Express service that only accepts signed requests from verified agents.
 *
 * Policy: testnet, age 18+, OFAC passed, at most 3 agents per human. Listens on :3000.
 */

import { SelfAgentVerifier } from "@selfxyz/agent-sdk";
import express from "express";

const verifier = SelfAgentVerifier.create()
  .network("testnet")
  .requireAge(18)
  .requireOFAC()
  .sybilLimit(3)
  .build();

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      // verifier.auth() checks the signature against the exact bytes sent
      (req as { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

app.use("/api", verifier.auth());

app.post("/api/data", (req, res) => {
  const agent = req.agent!; // set by verifier.auth()
  console.log("Verified agent:", agent.address);
  console.log("Credentials:", agent.credentials);
  res.json({ ok: true, agent: agent.address });
});

app.listen(3000, () => console.log("Service running on :3000"));
