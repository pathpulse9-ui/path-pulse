import SwiftUI
import GoogleSignIn
import Sentry

/// App entry — mirrors Android's `MainActivity.onCreate` + `setContent { PathPulseTheme { AppRoot() } }`.
@main
struct PathPulseApp: App {
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate

    init() {
        initSentry()
    }

    var body: some Scene {
        WindowGroup {
            AppRootView()
                .preferredColorScheme(.light) // app is light-only by design (matches web)
                .onOpenURL { url in
                    // Route OAuth callbacks (com.googleusercontent.apps.<id>://) to GIDSignIn.
                    GIDSignIn.sharedInstance.handle(url)
                }
        }
    }

    /// Fully opt-in: no DSN in Info.plist → Sentry stays dormant. Add the key
    /// `SentryDsn` to Info.plist (or ship via a build-time config) to turn it
    /// on. Keeps TestFlight builds silent until an org Sentry project is
    /// provisioned.
    private func initSentry() {
        let dsn = (Bundle.main.object(forInfoDictionaryKey: "SentryDsn") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard let dsn, !dsn.isEmpty else { return }
        SentrySDK.start { options in
            options.dsn = dsn
            options.environment = (Bundle.main.object(forInfoDictionaryKey: "SentryEnvironment") as? String) ?? "production"
            options.releaseName = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
            options.tracesSampleRate = 0.1
            options.attachStacktrace = true
            // Scrub session cookies before shipping breadcrumbs.
            options.beforeBreadcrumb = { crumb in
                if crumb.category == "http" {
                    crumb.data?.removeValue(forKey: "cookies")
                }
                return crumb
            }
        }
    }
}
