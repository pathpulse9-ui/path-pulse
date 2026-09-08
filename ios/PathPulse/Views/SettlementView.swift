import SwiftUI

/// Settlement tab — full list of settlement batches with a detail sheet.
struct SettlementView: View {
    @State private var batches: [SettlementBatch] = []
    @State private var loading = false
    @State private var errorMessage: String? = nil
    @State private var selected: SettlementBatch? = nil

    private let data = DataRepository()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PpSpace.md) {
                PpTabHeader(title: "Settlement", refreshing: loading, onRefresh: { Task { await refresh() } })
                if let errorMessage { PpErrorBanner(message: errorMessage) }

                PpCard {
                    PpCardHeader(
                        title: "\(batches.count) batch\(batches.count == 1 ? "" : "es")",
                        subtitle: "Newest first. Tap a row for driver-payout detail + Horizon link."
                    )

                    if batches.isEmpty && !loading {
                        PpEmptyState(
                            title: "No settlement activity yet",
                            message: "Run a settlement batch and it shows up here."
                        )
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(batches.enumerated()), id: \.element.id) { i, b in
                                if i > 0 { PpDivider() }
                                SettlementRow(batch: b)
                                    .contentShape(Rectangle())
                                    .onTapGesture { selected = b }
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
        .sheet(item: $selected) { b in
            SettlementDetailSheet(batch: b)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }

    @MainActor
    private func refresh() async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        do {
            batches = try await data.settlementBatches(limit: 50).items
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}

private struct SettlementRow: View {
    let batch: SettlementBatch

    var body: some View {
        HStack(spacing: PpSpace.md) {
            Text("ST")
                .font(PathPulseFont.labelSmall)
                .foregroundStyle(PathPulseColor.blue700)
                .frame(width: 36, height: 36)
                .background(PathPulseColor.blue50)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text("\(batch.grossAmount) \(batch.asset.code)")
                    .font(PathPulseFont.bodyMedium)
                    .foregroundStyle(PathPulseColor.black)
                PpMonospaceAddress(address: batch.txHash)
                    .font(.system(.caption, design: .monospaced))
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text(String(batch.createdAt.prefix(10)))
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PathPulseColor.black40)
            }
        }
        .padding(.vertical, PpSpace.md)
    }
}

private struct SettlementDetailSheet: View {
    let batch: SettlementBatch

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PpSpace.md) {
                Text("Settlement batch")
                    .font(PathPulseFont.headlineSmall)
                    .foregroundStyle(PathPulseColor.black)
                    .padding(.top, PpSpace.sm)

                PpCard {
                    PpCardHeader(title: "Split", subtitle: batch.grossAmount + " " + batch.asset.code + " gross")
                    VStack(spacing: PpSpace.md) {
                        splitRow(color: PathPulseColor.mint,   label: "Authorities (50%)",    amount: batch.split.authorities)
                        splitRow(color: PathPulseColor.mint58, label: "Driver rewards (30%)", amount: batch.split.driverRewards)
                        splitRow(color: PathPulseColor.mint26, label: "Treasury (20%)",       amount: batch.split.treasury)
                    }
                    .padding(.top, PpSpace.md)
                }

                if !batch.driverPayouts.isEmpty {
                    PpCard {
                        PpCardHeader(title: "Driver payouts", subtitle: "\(batch.driverPayouts.count) driver\(batch.driverPayouts.count == 1 ? "" : "s")")
                        VStack(spacing: 0) {
                            ForEach(Array(batch.driverPayouts.enumerated()), id: \.element.id) { i, p in
                                if i > 0 { PpDivider() }
                                HStack(spacing: PpSpace.md) {
                                    Text("SCOUT\(p.tier)")
                                        .font(PathPulseFont.labelSmall)
                                        .foregroundStyle(PathPulseColor.mintInk)
                                        .padding(.horizontal, PpSpace.sm)
                                        .padding(.vertical, PpSpace.xs)
                                        .background(scoutColor(p.tier))
                                        .clipShape(Capsule())
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(p.userId)
                                            .font(PathPulseFont.bodyMedium)
                                            .foregroundStyle(PathPulseColor.black)
                                            .lineLimit(1)
                                        PpMonospaceAddress(address: p.address)
                                    }
                                    Spacer()
                                    VStack(alignment: .trailing, spacing: 2) {
                                        Text("\(p.amount)")
                                            .font(PathPulseFont.bodyMedium)
                                            .foregroundStyle(PathPulseColor.black)
                                        Text(String(format: "%.1f×", p.multiplier))
                                            .font(PathPulseFont.bodySmall)
                                            .foregroundStyle(PathPulseColor.black40)
                                    }
                                }
                                .padding(.vertical, PpSpace.md)
                            }
                        }
                        .padding(.top, PpSpace.sm)
                    }
                }

                PpCard {
                    PpCardHeader(title: "On-chain")
                    VStack(alignment: .leading, spacing: PpSpace.sm) {
                        infoRow(label: "Batch id", value: batch.id, mono: true)
                        infoRow(label: "Tx hash",  value: batch.txHash, mono: true)
                        infoRow(label: "Network",  value: batch.network, mono: false)
                        if let src = batch.sourceAddress, !src.isEmpty {
                            infoRow(label: "Source", value: src, mono: true)
                        }
                        Link(destination: horizonURL) {
                            HStack(spacing: PpSpace.xs) {
                                Text("View on stellar.expert")
                                    .font(PathPulseFont.labelMedium)
                                Image(systemName: "arrow.up.right")
                                    .font(.system(size: 12, weight: .medium))
                            }
                            .foregroundStyle(PathPulseColor.accentBlue)
                        }
                        .padding(.top, PpSpace.sm)
                    }
                    .padding(.top, PpSpace.md)
                }
            }
            .padding(.horizontal, PpSize.screenPadding)
            .padding(.bottom, PpSpace.xxl)
        }
        .background(PathPulseColor.background)
    }

    private var horizonURL: URL {
        URL(string: "https://stellar.expert/explorer/testnet/tx/\(batch.txHash)")!
    }

    @ViewBuilder
    private func splitRow(color: Color, label: String, amount: String) -> some View {
        HStack {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label)
                .font(PathPulseFont.bodyMedium)
                .foregroundStyle(PathPulseColor.black70)
                .padding(.leading, PpSpace.sm)
            Spacer()
            Text(amount)
                .font(PathPulseFont.bodyMedium)
                .foregroundStyle(PathPulseColor.black)
        }
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

    private func scoutColor(_ tier: Int) -> Color {
        switch tier {
        case 1: return PathPulseColor.mint26
        case 2: return PathPulseColor.mint58
        default: return PathPulseColor.mint
        }
    }
}
