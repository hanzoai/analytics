/**
 * Runs once when the server starts. Analytics hears about visits from cloud's
 * event bus (src/lib/bus.ts); CLOUD_PUBSUB_URL is the one bus knob, as it is in
 * cloud, and a deployment without it serves the dashboard alone.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !process.env.CLOUD_PUBSUB_URL) {
    return;
  }
  const { listen } = await import('@/lib/bus');
  void listen(process.env.CLOUD_PUBSUB_URL);
}
