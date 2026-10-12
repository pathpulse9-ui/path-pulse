package com.pathpulse.driver

import android.app.Application
import io.sentry.android.core.SentryAndroid

/**
 * Application entry — hosts the Sentry init so it runs before any Activity.
 *
 * Sentry is opt-in: unless `SENTRY_DSN` is defined via BuildConfig (set from
 * local.properties or a CI env var), the SDK stays dormant. That keeps dev
 * builds silent while allowing release builds to be wired without touching
 * code. Add to local.properties:
 *   sentryDsn=https://…@sentry.io/…
 *   sentryEnvironment=staging
 */
class PathPulseApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        val dsn = BuildConfig.SENTRY_DSN
        if (dsn.isNotBlank()) {
            SentryAndroid.init(this) { options ->
                options.dsn = dsn
                options.environment = BuildConfig.SENTRY_ENVIRONMENT.ifBlank { "production" }
                options.release = BuildConfig.VERSION_NAME + "+" + BuildConfig.VERSION_CODE
                options.tracesSampleRate = 0.1
                options.isAttachStacktrace = true
            }
        }
    }
}
