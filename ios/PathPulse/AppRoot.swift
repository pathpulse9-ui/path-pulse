import SwiftUI

/// Top-level state machine — mirrors Android's `AppRoot()` composable.
///
/// State transitions (identical to Android):
///   • checkingSession → LoadingView
///   • no user + showLanding → LandingView → SignInView
///   • no user + !showLanding → SignInView
///   • user != null → AppShellView(tab)
struct AppRootView: View {
    @StateObject private var state = AppState()

    var body: some View {
        Group {
            if state.checkingSession {
                LoadingView()
            } else if state.user != nil {
                // AppShellView(state: state)  // PAT-60 will wire this
                PlaceholderView(
                    title: "Signed in",
                    message: "AppShell + tabs land in PAT-60. Signed in as \(state.user?.address ?? "…")."
                )
            } else if state.showLanding {
                LandingView(onGetStarted: { state.showLanding = false })
            } else {
                // SignInView(state: state)  // PAT-59 will wire this
                PlaceholderView(
                    title: "Sign in",
                    message: "SignInView with Google Sign-In lands in PAT-59."
                )
            }
        }
        .background(PathPulseColor.background.ignoresSafeArea())
        .task { await state.loadInitialSession() }
    }
}

/// Session + navigation state — pulled up so screens can mutate it via bindings.
@MainActor
final class AppState: ObservableObject {
    @Published var checkingSession: Bool = true
    @Published var showLanding: Bool = true
    @Published var user: SessionUser? = nil
    @Published var selectedTab: AppTab = .dashboard

    private let auth: AuthRepository

    init(auth: AuthRepository = AuthRepository()) {
        self.auth = auth
    }

    /// Called on first render — probes `/v1/auth/me` and hides the landing
    /// screen if a session cookie is already valid. Failures are non-fatal;
    /// the user just sees the landing screen and can sign in fresh.
    func loadInitialSession() async {
        defer { checkingSession = false }
        do {
            if let existing = try await auth.me() {
                user = existing
                showLanding = false
            }
        } catch {
            // Unauthenticated / network hiccup — fall through to landing.
        }
    }

    func signOut() async {
        await auth.logout()
        user = nil
        showLanding = true
    }
}

/// The 5 tabs (Android parity, `PpTab` in shell/AppShell.kt).
enum AppTab: String, CaseIterable, Identifiable {
    case dashboard, settlement, scout, offRamp, treasury
    var id: String { rawValue }

    var label: String {
        switch self {
        case .dashboard: return "Dashboard"
        case .settlement: return "Settlement"
        case .scout: return "SCOUT"
        case .offRamp: return "Off-ramp"
        case .treasury: return "Treasury"
        }
    }

    var systemImage: String {
        switch self {
        case .dashboard: return "chart.bar.xaxis"
        case .settlement: return "arrow.left.arrow.right"
        case .scout: return "star.fill"
        case .offRamp: return "arrow.up.right"
        case .treasury: return "building.columns"
        }
    }
}

// MARK: - Loading + placeholder

private struct LoadingView: View {
    var body: some View {
        ZStack {
            PathPulseColor.background.ignoresSafeArea()
            ProgressView().tint(.black)
        }
    }
}
