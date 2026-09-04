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

    /// Google OAuth client id. Same value the Android app uses so a single OAuth client
    /// covers both surfaces.
    static let googleWebClientID = "195179237561-jce7rmr4ou8jf2lsvt8lthv0q5h52o5a.apps.googleusercontent.com"
}
