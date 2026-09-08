import SwiftUI

/// Landing screen — 1:1 mirror of Android's `ui/LandingScreen.kt`.
///
/// Full-height scroll with three anchors: Header at the top (logo + wordmark
/// + TESTNET pill), Pitch stack in the middle (headline, body, deterministic-
/// split card, ecosystem marquee), Footer at the bottom (Get started arrow
/// button + trust footnote).
struct LandingView: View {
    let onGetStarted: () -> Void

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 0) {
                    header

                    Spacer(minLength: PpSpace.xxl)

                    pitch

                    Spacer(minLength: PpSpace.xxl)

                    footer
                }
                .padding(.horizontal, PpSpace.xxl)
                .padding(.vertical, PpSpace.xl)
                .frame(minHeight: geo.size.height)
            }
        }
        .background(PathPulseColor.background.ignoresSafeArea())
    }

    // MARK: - Header

    @ViewBuilder
    private var header: some View {
        HStack(spacing: PpSpace.md) {
            Image("LaunchLogo")
                .resizable()
                .scaledToFit()
                .frame(width: 28, height: 28)
            Text("PathPulse")
                .font(PathPulseFont.titleLarge)
                .foregroundStyle(PathPulseColor.black)
            Spacer()
            Text("TESTNET")
                .font(PathPulseFont.labelSmall)
                .foregroundStyle(PathPulseColor.black50)
                .padding(.horizontal, PpSpace.md)
                .padding(.vertical, 6)
                .background(PathPulseColor.surface)
                .clipShape(Capsule())
        }
    }

    // MARK: - Pitch stack

    @ViewBuilder
    private var pitch: some View {
        VStack(spacing: PpSpace.xs + 2) {
            landingCard {
                Text("Settlement,\nMade Verifiable")
                    .font(PathPulseFont.displayMedium)
                    .pathPulseKerning(.displayMedium)
                    .foregroundStyle(PathPulseColor.black)
                    .fixedSize(horizontal: false, vertical: true)
            }

            landingCard {
                Text("Revenue arrives once. The split is computed on-chain and settled as a single Stellar transaction anyone can verify.")
                    .font(PathPulseFont.bodyMedium)
                    .foregroundStyle(PathPulseColor.black70)
                    .fixedSize(horizontal: false, vertical: true)
            }

            splitCard

            landingCard(padding: PpSpace.lg) {
                EcosystemMarquee(items: [
                    "Freighter", "LOBSTR", "xBull", "ALBEDO", "Horizon", "Soroban", "SEP-10",
                ])
            }
        }
    }

    @ViewBuilder
    private var splitCard: some View {
        landingCard {
            Text("Deterministic split")
                .font(PathPulseFont.titleMedium)
                .foregroundStyle(PathPulseColor.black)
                .padding(.bottom, PpSpace.lg)

            GeometryReader { g in
                HStack(spacing: 2) {
                    Rectangle().fill(PathPulseColor.mint)
                        .frame(width: (g.size.width - 4) * 0.5)
                    Rectangle().fill(PathPulseColor.mint58)
                        .frame(width: (g.size.width - 4) * 0.3)
                    Rectangle().fill(PathPulseColor.mint26)
                        .frame(width: (g.size.width - 4) * 0.2)
                }
                .clipShape(Capsule())
            }
            .frame(height: 10)

            VStack(spacing: PpSpace.md) {
                legendRow(color: PathPulseColor.mint,   label: "Authorities",    share: "50%")
                legendRow(color: PathPulseColor.mint58, label: "Driver rewards", share: "30%")
                legendRow(color: PathPulseColor.mint26, label: "Treasury",       share: "20%")
            }
            .padding(.top, PpSpace.lg)
        }
    }

    @ViewBuilder
    private func legendRow(color: Color, label: String, share: String) -> some View {
        HStack {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label)
                .font(PathPulseFont.bodyMedium)
                .foregroundStyle(PathPulseColor.black70)
                .padding(.leading, PpSpace.md)
            Spacer()
            Text(share)
                .font(PathPulseFont.labelLarge)
                .foregroundStyle(PathPulseColor.black)
        }
    }

    // MARK: - Footer

    @ViewBuilder
    private var footer: some View {
        VStack(alignment: .leading, spacing: PpSpace.md) {
            arrowButton
            Text("Every batch settles to Stellar and is traceable treasury to recipient.")
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black40)
        }
    }

    @ViewBuilder
    private var arrowButton: some View {
        Button(action: onGetStarted) {
            ZStack {
                // Centered label
                Text("Get started")
                    .font(PathPulseFont.labelLarge)
                    .foregroundStyle(PathPulseColor.mintInk)

                // Trailing arrow circle
                HStack {
                    Spacer()
                    ZStack {
                        Circle().fill(PathPulseColor.mintInk).frame(width: 40, height: 40)
                        Image(systemName: "arrow.right")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(PathPulseColor.mint)
                    }
                    .padding(.trailing, 6)
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(PathPulseColor.mint)
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Card helper

    @ViewBuilder
    private func landingCard<Content: View>(
        padding: CGFloat = PpSpace.xl,
        @ViewBuilder _ content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) { content() }
            .padding(.horizontal, PpSpace.xxl)
            .padding(.vertical, padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PathPulseColor.surface)
            .ppCardShape()
    }
}

// MARK: - Ecosystem marquee

/// Auto-scrolling horizontal strip — mirrors Android's `PpMarquee`. Duplicates
/// the item list end-to-end and translates -width/2 over a fixed period so the
/// loop is seamless. Edge fade masks the scroll so it reads as an infinite belt.
private struct EcosystemMarquee: View {
    let items: [String]

    var body: some View {
        TimelineView(.animation) { timeline in
            let t = timeline.date.timeIntervalSinceReferenceDate
            GeometryReader { g in
                let period: Double = 24 // seconds per loop
                let progress = (t.truncatingRemainder(dividingBy: period)) / period
                let contentWidth = g.size.width
                let offset = -CGFloat(progress) * contentWidth

                HStack(spacing: PpSpace.xxl) {
                    ForEach(items + items, id: \.self) { item in
                        Text(item)
                            .font(PathPulseFont.labelMedium)
                            .foregroundStyle(PathPulseColor.black50)
                    }
                }
                .offset(x: offset)
                .fixedSize()
            }
            .mask(
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: .black, location: 0.08),
                        .init(color: .black, location: 0.92),
                        .init(color: .clear, location: 1),
                    ],
                    startPoint: .leading, endPoint: .trailing
                )
            )
        }
        .frame(height: 24)
    }
}

// MARK: - Placeholder used by other views

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
