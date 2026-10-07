// Runs once when a server instance starts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startupChecks } = await import("./instrumentation-node");
    await startupChecks();
  }
}
