// Invoke from a trusted scheduler only. No secret in command arguments or output.
const secret = process.env.SOCIAL_METRICS_SECRET;
const base = new URL(
  process.env.AG_SITE_URL ?? "https://arquivoglobal.vercel.app",
);
if (!secret || secret.length < 32 || base.protocol !== "https:")
  throw Error(
    "Set the existing server secret and HTTPS AG_SITE_URL in the scheduler environment.",
  );
const response = await fetch(new URL("/api/notification-jobs", base), {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
  redirect: "error",
  signal: AbortSignal.timeout(25000),
});
if (!response.ok)
  throw Error(
    `Notification processing unavailable (${response.status}); no credentials logged.`,
  );
const result = await response.json();
console.log({
  enabled: result.enabled,
  processed: result.processed,
  delivered: result.delivered,
});
