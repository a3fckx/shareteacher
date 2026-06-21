import { getOrchestrator } from "@/server/orchestrator";

async function main() {
  const orch = getOrchestrator();
  const sessionId = "test-debug-session-123";
  console.log("Creating session...");
  try {
    const id = await orch.createSession({ lessonId: "ppt-chatgpt" });
    console.log("Created session:", id);
    console.log("Waiting 5 seconds for pre-warm...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const summary = await orch.getSummary(id);
    console.log("Summary after pre-warm:", JSON.stringify(summary, null, 2));
  } catch (err) {
    console.error("Fatal error:", err);
  }
}

main().catch(console.error);
