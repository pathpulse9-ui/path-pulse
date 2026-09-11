import SwiftUI

/// Off-ramp tab — list of USDC → fiat withdrawal sessions with status pills.
struct OffRampView: View {
    @State private var sessions: [OffRampSession] = []
    @State private var loading = false
    @State private var errorMessage: String? = nil
    @State private var limits: CarretLimits? = nil
    @State private var kycSheetOpen = false

    private let data = DataRepository()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PpSpace.md) {
                PpTabHeader(title: "Off-ramp", refreshing: loading, onRefresh: { Task { await refresh() } })
                if let errorMessage { PpErrorBanner(message: errorMessage) }

                // KYC banner — always visible; opens the full 6-section flow.
                PpCard {
                    HStack(spacing: PpSpace.md) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Verify your identity")
                                .font(PathPulseFont.titleMedium)
                                .foregroundStyle(PathPulseColor.black)
                            Text("A quick one-time check before your first withdrawal.")
                                .font(PathPulseFont.bodySmall)
                                .foregroundStyle(PathPulseColor.black60)
                        }
                        Spacer()
                        Button(action: { kycSheetOpen = true }) {
                            Text("Start")
                                .font(PathPulseFont.labelMedium)
                                .foregroundStyle(PathPulseColor.white)
                                .padding(.horizontal, PpSpace.md)
                                .padding(.vertical, PpSpace.sm)
                                .background(PathPulseColor.black)
                                .clipShape(Capsule())
                        }
                    }
                }

                if let l = limits {
                    HStack(spacing: PpSpace.sm) {
                        Text("₹\(Int(l.remaining.withdraw_inr).formatted()) available today")
                            .font(PathPulseFont.labelSmall)
                            .foregroundStyle(l.remaining.withdraw_inr > 0 ? PathPulseColor.mintInk : PathPulseColor.red700)
                            .padding(.horizontal, PpSpace.md)
                            .padding(.vertical, PpSpace.xs)
                            .background(l.remaining.withdraw_inr > 0 ? PathPulseColor.mint26 : PathPulseColor.red100)
                            .clipShape(Capsule())
                        Text("of ₹\(Int(l.dailyCapInr).formatted()) daily limit")
                            .font(PathPulseFont.bodySmall)
                            .foregroundStyle(PathPulseColor.black40)
                    }
                }

                PpCard {
                    PpCardHeader(
                        title: sessions.count == 1 ? "1 withdrawal" : "\(sessions.count) withdrawals",
                        subtitle: "Convert your USDC rewards to INR in your bank."
                    )

                    if sessions.isEmpty && !loading {
                        PpEmptyState(
                            title: "No withdrawals yet",
                            message: "Your withdrawals will appear here."
                        )
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(sessions.enumerated()), id: \.element.id) { i, s in
                                if i > 0 { PpDivider() }
                                OffRampRow(session: s)
                            }
                        }
                        .padding(.top, PpSpace.sm)
                    }
                }
            }
            .padding(.horizontal, PpSize.screenPadding)
            .padding(.bottom, PpSpace.xxl)
        }
        .background(PathPulseColor.background)
        .task { await refresh() }
        .refreshable { await refresh() }
        .sheet(isPresented: $kycSheetOpen) { KycView() }
    }

    @MainActor
    private func refresh() async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        do {
            async let s = data.offRampSessions(limit: 50)
            async let l = data.carretLimits()
            sessions = try await s.items
            // Limits call is best-effort — missing sub-account etc. leaves the chip hidden.
            limits = (try? await l)
        } catch {
            errorMessage = UserErrors.message(error)
        }
    }
}

private struct OffRampRow: View {
    let session: OffRampSession

    var body: some View {
        HStack(spacing: PpSpace.md) {
            Text("OR")
                .font(PathPulseFont.labelSmall)
                .foregroundStyle(PathPulseColor.teal700)
                .frame(width: 36, height: 36)
                .background(PathPulseColor.teal50)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: PpSpace.sm) {
                    Text(session.provider.capitalized)
                        .font(PathPulseFont.bodyMedium)
                        .foregroundStyle(PathPulseColor.black)
                    PpStatusPill(
                        text: session.status.replacingOccurrences(of: "_", with: " "),
                        color: Color.ppOffRampStatus(session.status)
                    )
                }
                Text("→ \(session.fiatCurrency)")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text("\(session.amount) \(session.asset.code)")
                    .font(PathPulseFont.bodyMedium)
                    .foregroundStyle(PathPulseColor.black)
                Text(String(session.createdAt.prefix(10)))
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
            }
        }
        .padding(.vertical, PpSpace.md)
    }
}
