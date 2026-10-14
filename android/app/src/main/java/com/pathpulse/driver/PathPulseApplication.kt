package com.pathpulse.driver

import android.app.Application
import io.sentry.android.core.SentryAndroid

/**
 * Application entry — hosts the Sentry init so it runs before any Activity.
 *
 * Sentry is opt-in: unless `SENTRY_DSN` is defined via BuildConfig (set from
 * local.properties or a CI env var), the SDK stays dormant. The environment
 * tag is the Stellar network the build targets (testnet / mainnet). PII is
 * scrubbed before send; crashes stay the point of Sentry, not telemetry.
 */
class PathPulseApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.SENTRY_DSN.isEmpty()) return
        SentryAndroid.init(this) { options ->
            options.dsn = BuildConfig.SENTRY_DSN
            options.environment = BuildConfig.STELLAR_NETWORK
            options.release = "${BuildConfig.APPLICATION_ID}@${BuildConfig.VERSION_NAME}+${BuildConfig.VERSION_CODE}"
            options.tracesSampleRate = 0.1
            options.isAttachStacktrace = true
            options.isSendDefaultPii = false
            options.setBeforeSend { event, _ ->
                event.request = null
                event.user = null
                event
            }
        }
    }
}
