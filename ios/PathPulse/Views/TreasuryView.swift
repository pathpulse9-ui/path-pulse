import SwiftUI

/// Treasury tab — treasury multisig config + distribution accounts, so anyone
/// can verify the on-chain 2-of-N and the 50/30/20 destination accounts.
struct TreasuryView: View {
    @State private var config: TreasuryConfig? = nil
    @State private var accounts: [DistributionAccount] = []
    @State private var loading = false
    @State private var errorMessage: String? = nil

    private let data = DataRepository()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PpSpace.md) {
                PpTabHeader(title: "Treasury", refreshing: loading, onRefresh: { Task { await refresh() } })
                if let errorMessage { PpErrorBanner(message: errorMessage) }

                treasuryCard
                distributionCard
            }
            .padding(.horizontal, PpSize.screenPadding)
            .padding(.bottom, PpSpace.xxl)
        }
        .background(PathPulseColor.background)
        .task { await refresh() }
        .refreshable { await refresh() }
    }

    @ViewBuilder
    private var treasuryCard: some View {
        PpCard {
            PpCardHeader(
                title: "Treasury multisig",
                subtitle: "Master key at weight 0 disables direct signing; N-of-M signers required."
            )
            if let c = config {
                VStack(alignment: .leading, spacing: PpSpace.md) {
                    infoRow(label: "Public key", value: c.publicKey, mono: true)
                    infoRow(label: "Network",    value: c.network,   mono: false)

                    HStack(spacing: PpSpace.md) {
                        thresholdChip(label: "Low",    value: c.thresholds.low)
                        thresholdChip(label: "Medium", value: c.thresholds.medium)
                        thresholdChip(label: "High",   value: c.thresholds.high)
                    }
                }
                .padding(.top, PpSpace.md)

                PpDivider().padding(.vertical, PpSpace.md)

                Text("Signers (\(c.signers.count))")
                    .font(PathPulseFont.labelMedium)
                    .foregroundStyle(PathPulseColor.black50)

                VStack(spacing: 0) {
                    ForEach(Array(c.signers.enumerated()), id: \.offset) { i, s in
                        if i > 0 { PpDivider() }
                        HStack {
                            PpMonospaceAddress(address: s.publicKey)
                            Spacer()
                            Text("weight \(s.weight)")
                                .font(PathPulseFont.labelSmall)
                                .foregroundStyle(s.weight == 0 ? PathPulseColor.red600 : PathPulseColor.mintInk)
                                .padding(.horizontal, PpSpace.sm)
                                .padding(.vertical, PpSpace.xs)
                                .background(s.weight == 0 ? PathPulseColor.red100 : PathPulseColor.mint26)
                                .clipShape(Capsule())
                        }
                        .padding(.vertical, PpSpace.md)
                    }
                }
                .padding(.top, PpSpace.sm)
            } else if loading {
                Text("Loading…")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
                    .padding(.top, PpSpace.lg)
            }
        }
    }

    @ViewBuilder
    private var distributionCard: some View {
        PpCard {
            PpCardHeader(
                title: "Distribution accounts",
                subtitle: "Destinations for the 50/30/20 settlement split."
            )
            if accounts.isEmpty && loading {
                Text("Loading…")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
                    .padding(.top, PpSpace.lg)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(accounts.enumerated()), id: \.element.id) { i, a in
                        if i > 0 { PpDivider() }
                        VStack(alignment: .leading, spacing: PpSpace.xs) {
                            HStack(spacing: PpSpace.sm) {
                                Text(a.label)
                                    .font(PathPulseFont.bodyMedium)
                                    .foregroundStyle(PathPulseColor.black)
                                if a.multisig {
                                    Text("multisig")
                                        .font(PathPulseFont.labelSmall)
                                        .foregroundStyle(PathPulseColor.mintInk)
                                        .padding(.horizontal, PpSpace.sm)
                                        .padding(.vertical, PpSpace.xs)
                                        .background(PathPulseColor.mint26)
                                        .clipShape(Capsule())
                                }
                            }
                            PpMonospaceAddress(address: a.publicKey)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, PpSpace.md)
                    }
                }
                .padding(.top, PpSpace.sm)
            }
        }
    }

    @ViewBuilder
    private func thresholdChip(label: String, value: Int) -> some View {
        VStack(spacing: 2) {
            Text(label)
                .font(PathPulseFont.labelSmall)
                .foregroundStyle(PathPulseColor.black40)
            Text("\(value)")
                .font(PathPulseFont.titleMedium)
                .foregroundStyle(PathPulseColor.black)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, PpSpace.md)
        .background(PathPulseColor.black05)
        .ppTileShape()
    }

    @ViewBuilder
    private func infoRow(label: String, value: String, mono: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(PathPulseFont.labelSmall)
                .foregroundStyle(PathPulseColor.black40)
            Text(value)
                .font(mono ? .system(.footnote, design: .monospaced) : PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black70)
                .lineLimit(2)
        }
    }

    @MainActor
    private func refresh() async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        do {
            async let c = data.treasuryConfig()
            async let a = data.distributionAccounts()
            let (cp, ap) = try await (c, a)
            config = cp
            accounts = ap
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}
