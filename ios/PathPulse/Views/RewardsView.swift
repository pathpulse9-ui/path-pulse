import SwiftUI

struct RewardsCard: View {
    let rewards: RewardsResponse
    let onSeeAll: () -> Void

    var body: some View {
        PpCard {
            VStack(alignment: .leading, spacing: PpSpace.md) {
                HStack {
                    PpCardHeader(title: "My rewards", subtitle: "Balance and payouts received by your wallet.")
                    Spacer()
                    if !rewards.items.isEmpty {
                        Button("See all", action: onSeeAll)
                            .font(PathPulseFont.labelMedium)
                            .foregroundStyle(PathPulseColor.black)
                    }
                }
                if rewards.address == nil {
                    PpEmptyState(title: "No wallet yet", message: "Sign in with Google to get a rewards wallet.")
                } else {
                    balances(rewards.balances)
                    if rewards.items.isEmpty {
                        PpEmptyState(title: "No payouts yet", message: "Rewards from settlements appear here.")
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(rewards.items.prefix(3).enumerated()), id: \.element.id) { i, p in
                                if i > 0 { PpDivider() }
                                RewardPayoutRow(payout: p)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private func balances(_ balances: [RewardBalance]) -> some View {
        HStack(spacing: PpSpace.md) {
            ForEach(balances, id: \.asset.code) { b in
                VStack(alignment: .leading, spacing: 2) {
                    Text(RewardFormat.amount(b.balance))
                        .font(PathPulseFont.titleLarge)
                        .foregroundStyle(PathPulseColor.black)
                    Text(b.asset.code)
                        .font(PathPulseFont.labelSmall)
                        .foregroundStyle(PathPulseColor.black50)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(PpSpace.md)
                .background(PathPulseColor.background)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
    }
}

struct RewardPayoutRow: View {
    let payout: RewardPayout

    var body: some View {
        HStack(spacing: PpSpace.md) {
            Image(systemName: "arrow.down.left")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PathPulseColor.mintInk)
                .frame(width: 36, height: 36)
                .background(PathPulseColor.mint26)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text("+\(RewardFormat.amount(payout.amount)) \(payout.asset.code)")
                    .font(PathPulseFont.bodyMedium)
                    .foregroundStyle(PathPulseColor.black)
                Text(RewardFormat.date(payout.createdAt))
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
            }
            Spacer()
            if let url = URL(string: payout.explorerUrl) {
                Link(destination: url) {
                    Image(systemName: "arrow.up.right.square")
                        .foregroundStyle(PathPulseColor.black40)
                }
            }
        }
        .padding(.vertical, PpSpace.sm)
    }
}

struct RewardsHistorySheet: View {
    let data: DataRepository
    @Environment(\.dismiss) private var dismiss

    @State private var items: [RewardPayout] = []
    @State private var nextCursor: String? = nil
    @State private var loading = false
    @State private var error: String? = nil

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: PpSpace.md) {
                    if let error { PpErrorBanner(message: error) }
                    PpCard {
                        if items.isEmpty && !loading {
                            PpEmptyState(title: "No payouts yet", message: "Rewards from settlements appear here.")
                        } else {
                            VStack(spacing: 0) {
                                ForEach(Array(items.enumerated()), id: \.element.id) { i, p in
                                    if i > 0 { PpDivider() }
                                    RewardPayoutRow(payout: p)
                                }
                            }
                        }
                    }
                    if loading {
                        ProgressView().frame(maxWidth: .infinity)
                    } else if nextCursor != nil {
                        Button(action: { Task { await load() } }) {
                            Text("Load more")
                                .font(PathPulseFont.labelMedium)
                                .foregroundStyle(PathPulseColor.black)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, PpSpace.md)
                                .overlay(Capsule().stroke(PathPulseColor.black15, lineWidth: 1))
                        }
                    }
                }
                .padding(PpSize.screenPadding)
            }
            .background(PathPulseColor.background)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Payout history")
                        .font(PathPulseFont.labelLarge)
                        .foregroundStyle(PathPulseColor.black)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button(action: { dismiss() }) {
                        Image(systemName: "xmark").foregroundStyle(PathPulseColor.black)
                    }
                }
            }
        }
        .task { await load() }
    }

    @MainActor private func load() async {
        guard !loading else { return }
        loading = true; error = nil
        defer { loading = false }
        do {
            let page = try await data.rewards(limit: 50, cursor: nextCursor)
            items += page.items
            nextCursor = page.nextCursor
        } catch {
            self.error = UserErrors.message(error)
        }
    }
}

enum RewardFormat {
    static func amount(_ raw: String) -> String {
        guard let value = Double(raw) else { return raw }
        return value.formatted(.number.precision(.fractionLength(0...4)))
    }

    static func date(_ iso: String) -> String {
        guard let date = try? Date(iso, strategy: .iso8601) else { return iso }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}
