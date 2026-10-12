// Next.js runtime instrumentation hook — loads the right Sentry config
// per runtime. Called once at process boot. SENTRY_DSN unset → each config
// no-ops, so there's no cost when Sentry isn't configured.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
