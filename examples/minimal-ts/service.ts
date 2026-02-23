import { SelfAgentVerifier } from "@selfxyz/agent-sdk";
import express from "express";

// Build a verifier with policy
const verifier = SelfAgentVerifier.create()
  .network("testnet")
  .requireAge(18)
  .requireOFAC()
  .sybilLimit(3)
  .build();

const app = express();
app.use(express.json());

// Protect routes with agent verification middleware
app.use("/api", verifier.auth());

app.post("/api/data", (req, res) => {
  console.log("Verified agent:", req.agent.address);
  console.log("Credentials:", req.agent.credentials);
  res.json({ ok: true, agent: req.agent.address });
});

app.listen(3000, () => console.log("Service running on :3000"));
