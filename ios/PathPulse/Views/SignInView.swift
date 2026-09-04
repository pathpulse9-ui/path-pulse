import SwiftUI
import GoogleSignIn

/// Sign-in screen — mirrors Android's `ui/SignInScreen.kt`.
///
/// Two entry points:
///   • Google — full OAuth via `GIDSignIn` (needs `Config.googleIOSClientID` set).
///   • Guest  — read-only session, backed by `POST /v1/auth/guest`.
struct SignInView: View {
    @EnvironmentObject private var state: AppState

    @State private var pending: Pending? = nil
    @State private var error: String? = nil

    enum Pending { case google, guest }
    private var busy: Bool { pending != nil }

    var body: some View {
        ZStack {
            PathPulseColor.background.ignoresSafeArea()

            VStack(alignment: .leading, spacing: 0) {
                Text("PathPulse")
                    .font(PathPulseFont.headlineSmall)
                    .pathPulseKerning(.headlineSmall)
                    .foregroundStyle(PathPulseColor.black)
                    .padding(.bottom, PpSpace.xxxl)

                Text("Payments starts here")
                    .font(PathPulseFont.headlineMedium)
                    .pathPulseKerning(.headlineMedium)
                    .foregroundStyle(PathPulseColor.black)
                    .padding(.bottom, PpSpace.md)

                Text("Sign in to continue, or browse the console as a guest.")
                    .font(PathPulseFont.bodyLarge)
                    .foregroundStyle(PathPulseColor.black60)
                    .padding(.bottom, PpSpace.xxxl)

                primaryButton(
                    title: pending == .google ? "Signing in…" : "Continue with Google",
                    action: signInWithGoogle
                )
                .padding(.bottom, PpSpace.md)

                secondaryButton(
                    title: pending == .guest ? "Starting…" : "Continue as Guest",
                    action: signInAsGuest
                )

                Text("Guests get read-only access — no wallet, no payouts, no off-ramp.")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
                    .padding(.top, PpSpace.md)

                if let error {
                    Text(error)
                        .font(PathPulseFont.bodyMedium)
                        .foregroundStyle(PathPulseColor.red700)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(PpSpace.md)
                        .background(PathPulseColor.red100)
                        .ppTileShape()
                        .padding(.top, PpSpace.xl)
                }

                Text("By continuing, you agree to our Terms and Privacy Policy.")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
                    .padding(.top, PpSpace.xxxl)
            }
            .padding(.horizontal, PpSpace.xxl)
        }
    }

    // MARK: - Buttons

    @ViewBuilder
    private func primaryButton(title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(PathPulseFont.labelLarge)
                .foregroundStyle(PathPulseColor.white)
                .frame(maxWidth: .infinity)
                .frame(height: PpSize.control)
                .background(busy ? PathPulseColor.black50 : PathPulseColor.black)
                .clipShape(Capsule())
        }
        .disabled(busy)
    }

    @ViewBuilder
    private func secondaryButton(title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(PathPulseFont.labelLarge)
                .foregroundStyle(PathPulseColor.black)
                .frame(maxWidth: .infinity)
                .frame(height: PpSize.control)
                .background(
                    Capsule()
                        .stroke(PathPulseColor.black15, lineWidth: 1)
                        .background(PathPulseColor.surface.clipShape(Capsule()))
                )
        }
        .disabled(busy)
    }

    // MARK: - Actions

    private func signInWithGoogle() {
        guard Config.googleIOSConfigured else {
            error = "Google sign-in isn't configured on this build. Set Config.googleIOSClientID + the URL scheme in project.yml, then rebuild. (Guest sign-in still works.)"
            return
        }
        guard let root = topViewController() else {
            error = "Couldn't find a view controller to present sign-in from."
            return
        }

        pending = .google
        error = nil

        // Configure with iOS client id + web client id (so returned id-token's audience
        // matches the backend's verifier).
        GIDSignIn.sharedInstance.configuration = GIDConfiguration(
            clientID: Config.googleIOSClientID,
            serverClientID: Config.googleWebClientID
        )

        GIDSignIn.sharedInstance.signIn(withPresenting: root) { result, err in
            // Pull Sendable primitives out of `result` before crossing the actor
            // boundary — GIDSignInResult itself isn't Sendable.
            let idToken: String? = result?.user.idToken?.tokenString
            let errMessage: String? = err?.localizedDescription
            Task { @MainActor in
                if let errMessage {
                    pending = nil
                    error = errMessage
                    return
                }
                guard let idToken else {
                    pending = nil
                    error = "Google didn't return an id-token."
                    return
                }
                await exchangeIdToken(idToken)
                pending = nil
            }
        }
    }

    private func signInAsGuest() {
        pending = .guest
        error = nil
        Task {
            do {
                _ = try await AuthRepository().continueAsGuest()
                // Guest session cookie is now set — re-probe /me to hydrate AppState.
                if let user = try await AuthRepository().me() {
                    state.user = user
                    state.showLanding = false
                } else {
                    error = "Guest session created but /me returned no user."
                }
            } catch {
                self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
            pending = nil
        }
    }

    private func exchangeIdToken(_ idToken: String) async {
        do {
            let resp = try await AuthRepository().verifyGoogleIdToken(idToken)
            // Backend set the session cookie; hydrate AppState via /me.
            if let user = try await AuthRepository().me() {
                state.user = user
                state.showLanding = false
            } else {
                state.user = SessionUser(
                    userId: resp.userId,
                    method: "google",
                    email: nil,
                    address: resp.wallet.address
                )
                state.showLanding = false
            }
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Grab the frontmost view controller so `GIDSignIn` has something to present from.
    private func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first(where: { $0.activationState == .foregroundActive })
        var vc = scene?.keyWindow?.rootViewController
        while let presented = vc?.presentedViewController { vc = presented }
        return vc
    }
}

#Preview("SignIn") {
    SignInView().environmentObject(AppState())
}

#Preview("SignIn — Error") {
    let view = SignInView()
    return view.environmentObject(AppState())
}
