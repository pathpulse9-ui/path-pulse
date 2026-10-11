package com.pathpulse.driver

import android.app.Application
import io.sentry.android.core.SentryAndroid

class PathPulseApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.SENTRY_DSN.isEmpty()) return
        SentryAndroid.init(this) { options ->
            options.dsn = BuildConfig.SENTRY_DSN
            options.environment = BuildConfig.STELLAR_NETWORK
            options.release = "${BuildConfig.APPLICATION_ID}@${BuildConfig.VERSION_NAME}+${BuildConfig.VERSION_CODE}"
            options.isSendDefaultPii = false
            options.setBeforeSend { event, _ ->
                event.request = null
                event.user = null
                event
            }
        }
    }
}
