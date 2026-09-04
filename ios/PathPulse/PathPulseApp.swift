import SwiftUI
import GoogleSignIn

/// App entry — mirrors Android's `MainActivity.onCreate` + `setContent { PathPulseTheme { AppRoot() } }`.
@main
struct PathPulseApp: App {
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
}
