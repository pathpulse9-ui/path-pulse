import Foundation

/// App-wide constants. Mirrors `android/app/src/main/java/com/pathpulse/driver/Config.kt`
/// and stays in lock-step with the backend contract at `packages/contract/openapi.yaml`.
enum Config {
    /// Backend base URL. Local dev: `http://localhost:8080` (Simulator reaches the Mac host
    /// directly). Deployed: `https://demo-api.pathpulse.ai`.
    static let apiBaseURL: URL = {
        #if DEBUG
        return URL(string: "http://localhost:8080")!
        #else
        return URL(string: "https://demo-api.pathpulse.ai")!
        #endif
    }()

    /// Google OAuth **web** client id — same value the Android app uses. This is passed
    /// to `GIDSignIn` as `serverClientID` so the returned id-token's audience matches
    /// what the backend verifies against.
    static let googleWebClientID = "195179237561-jce7rmr4ou8jf2lsvt8lthv0q5h52o5a.apps.googleusercontent.com"

    /// Google OAuth **iOS** client id. Required by `GIDSignIn` for the native flow.
    /// Create this in Google Cloud Console → APIs & Services → Credentials → "Create
    /// credentials" → OAuth client ID → iOS, with bundle id `ai.pathpulse.driver`.
    ///
    /// You must ALSO add its reversed form (com.googleusercontent.apps.<id>) as a
    /// URL scheme in `project.yml` → CFBundleURLTypes so the OAuth callback opens
    /// the app.
    ///
    /// While this is the placeholder value below, the Google button in `SignInView`
    /// stays disabled with a helpful message. Guest sign-in still works.
    static let googleIOSClientID = "REPLACE_WITH_IOS_OAUTH_CLIENT_ID.apps.googleusercontent.com"

    /// True once the iOS client id has been filled in — used by `SignInView` to gate
    /// the Google button without crashing.
    static var googleIOSConfigured: Bool {
        !googleIOSClientID.hasPrefix("REPLACE_WITH_")
    }
}
