import SwiftUI

/// Hero landing screen — first thing an unauthenticated user sees.
/// Mirrors Android's `ui/LandingScreen.kt`. Tapping "Get started" transitions
/// to `SignInView` (state managed at `AppRoot`).
struct LandingView: View {
    let onGetStarted: () -> Void

    var body: some View {
        ZStack {
            PathPulseColor.background.ignoresSafeArea()

            VStack(spacing: PpSpace.xxl) {
                Spacer()

                // Logo mark placeholder — swap for the real asset once bundled.
                RoundedRectangle(cornerRadius: PpRadius.md, style: .continuous)
                    .fill(PathPulseColor.mint)
                    .frame(width: 88, height: 88)
                    .overlay(
                        Image(systemName: "waveform.path.ecg")
                            .font(.system(size: 44, weight: .semibold))
                            .foregroundStyle(PathPulseColor.mintInk)
                    )

                VStack(spacing: PpSpace.md) {
                    Text("PathPulse")
                        .font(PathPulseFont.displayMedium)
                        .pathPulseKerning(.displayMedium)
                        .foregroundStyle(PathPulseColor.black)
                    Text("Stellar settlement infrastructure for drivers")
                        .font(PathPulseFont.bodyLarge)
                        .foregroundStyle(PathPulseColor.black60)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, PpSpace.xxl)
                }

                Spacer()

                Button(action: onGetStarted) {
                    Text("Get started")
                        .font(PathPulseFont.labelLarge)
                        .foregroundStyle(PathPulseColor.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: PpSize.control)
                        .background(PathPulseColor.black)
                        .clipShape(Capsule())
                }
                .padding(.horizontal, PpSize.screenPadding)
                .padding(.bottom, PpSpace.xl)
            }
        }
    }
}

/// Reusable "not yet available" screen — matches Android's `PlaceholderScreen.kt`.
struct PlaceholderView: View {
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: PpSpace.lg) {
            Text(title)
                .font(PathPulseFont.headlineMedium)
                .pathPulseKerning(.headlineMedium)
                .foregroundStyle(PathPulseColor.black)
            Text(message)
                .font(PathPulseFont.bodyMedium)
                .foregroundStyle(PathPulseColor.black60)
                .multilineTextAlignment(.center)
                .padding(.horizontal, PpSpace.xxl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(PathPulseColor.background)
    }
}

#Preview("Landing") {
    LandingView(onGetStarted: {})
}

#Preview("Placeholder") {
    PlaceholderView(
        title: "Settlement",
        message: "Creating settlement batches and bulk payouts is available in the web console."
    )
}
