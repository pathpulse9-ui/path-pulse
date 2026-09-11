import SwiftUI

/// SCOUT reputation tab — issuer + tier definitions + per-address lookup.
struct ScoutView: View {
    @State private var roster: ScoutRoster? = nil
    @State private var loading = false
    @State private var errorMessage: String? = nil

    @State private var lookupInput = ""
    @State private var lookupResult: ScoutTierLookup? = nil
    @State private var lookupError: String? = nil
    @State private var lookingUp = false

    private let data = DataRepository()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PpSpace.md) {
                PpTabHeader(title: "SCOUT", refreshing: loading, onRefresh: { Task { await refresh() } })
                if let errorMessage { PpErrorBanner(message: errorMessage) }

                tiersCard
                lookupCard
            }
            .padding(.horizontal, PpSize.screenPadding)
            .padding(.bottom, PpSpace.xxl)
        }
        .background(PathPulseColor.background)
        .task { await refresh() }
        .refreshable { await refresh() }
    }

    @ViewBuilder
    private var tiersCard: some View {
        PpCard {
            PpCardHeader(title: "Reputation tiers", subtitle: "Higher tiers earn a bigger share of each reward.")
            if let roster {
                VStack(alignment: .leading, spacing: PpSpace.sm) {
                    HStack {
                        Text("Issuer")
                            .font(PathPulseFont.labelSmall)
                            .foregroundStyle(PathPulseColor.black40)
                        Spacer()
                        PpMonospaceAddress(address: roster.issuer)
                    }
                    HStack {
                        Text("Network")
                            .font(PathPulseFont.labelSmall)
                            .foregroundStyle(PathPulseColor.black40)
                        Spacer()
                        Text(roster.network)
                            .font(PathPulseFont.bodySmall)
                            .foregroundStyle(PathPulseColor.black70)
                    }
                }
                .padding(.top, PpSpace.md)

                PpDivider().padding(.vertical, PpSpace.md)

                VStack(spacing: PpSpace.md) {
                    ForEach(roster.tiers) { t in
                        HStack {
                            Text(t.code)
                                .font(PathPulseFont.labelSmall)
                                .foregroundStyle(PathPulseColor.mintInk)
                                .padding(.horizontal, PpSpace.sm)
                                .padding(.vertical, PpSpace.xs)
                                .background(tierColor(t.tier))
                                .clipShape(Capsule())
                            Text("Tier \(t.tier)")
                                .font(PathPulseFont.bodyMedium)
                                .foregroundStyle(PathPulseColor.black)
                                .padding(.leading, PpSpace.sm)
                            Spacer()
                            Text(String(format: "%.1f×", t.multiplier))
                                .font(PathPulseFont.titleMedium)
                                .foregroundStyle(PathPulseColor.black)
                        }
                    }
                }
            } else if loading {
                Text("Loading…")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
                    .padding(.top, PpSpace.lg)
            }
        }
    }

    @ViewBuilder
    private var lookupCard: some View {
        PpCard {
            PpCardHeader(title: "Check a driver", subtitle: "Look up any driver's current reputation tier.")

            HStack(spacing: PpSpace.sm) {
                TextField("G…", text: $lookupInput)
                    .font(.system(.footnote, design: .monospaced))
                    .textFieldStyle(.plain)
                    .autocorrectionDisabled(true)
                    .textInputAutocapitalization(.characters)
                    .padding(.horizontal, PpSpace.md)
                    .frame(height: 40)
                    .background(PathPulseColor.black05)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button(action: { Task { await lookup() } }) {
                    Text(lookingUp ? "…" : "Look up")
                        .font(PathPulseFont.labelMedium)
                        .foregroundStyle(PathPulseColor.white)
                        .padding(.horizontal, PpSpace.md)
                        .frame(height: 40)
                        .background(lookingUp || lookupInput.isEmpty ? PathPulseColor.black50 : PathPulseColor.black)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .disabled(lookingUp || lookupInput.isEmpty)
            }
            .padding(.top, PpSpace.md)

            if let lookupError {
                Text(lookupError)
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.red600)
                    .padding(.top, PpSpace.md)
            } else if let r = lookupResult {
                lookupResultView(r)
                    .padding(.top, PpSpace.md)
            }
        }
    }

    @ViewBuilder
    private func lookupResultView(_ r: ScoutTierLookup) -> some View {
        if let tier = r.tier, let code = r.code, let mult = r.multiplier {
            HStack {
                Text(code)
                    .font(PathPulseFont.labelSmall)
                    .foregroundStyle(PathPulseColor.mintInk)
                    .padding(.horizontal, PpSpace.sm)
                    .padding(.vertical, PpSpace.xs)
                    .background(tierColor(tier))
                    .clipShape(Capsule())
                Text("Tier \(tier)")
                    .font(PathPulseFont.bodyMedium)
                    .foregroundStyle(PathPulseColor.black)
                    .padding(.leading, PpSpace.sm)
                Spacer()
                Text(String(format: "%.1f× multiplier", mult))
                    .font(PathPulseFont.bodyMedium)
                    .foregroundStyle(PathPulseColor.black70)
            }
            .padding(PpSpace.md)
            .background(PathPulseColor.black05)
            .ppTileShape()
        } else {
            Text("No SCOUT badge held.")
                .font(PathPulseFont.bodyMedium)
                .foregroundStyle(PathPulseColor.black50)
                .padding(PpSpace.md)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(PathPulseColor.black05)
                .ppTileShape()
        }
    }

    @MainActor
    private func refresh() async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        do { roster = try await data.scoutRoster() }
        catch {
            errorMessage = UserErrors.message(error)
        }
    }

    @MainActor
    private func lookup() async {
        let addr = lookupInput.trimmingCharacters(in: .whitespaces)
        guard !addr.isEmpty else { return }
        lookingUp = true
        lookupResult = nil
        lookupError = nil
        defer { lookingUp = false }
        do {
            lookupResult = try await data.scoutLookup(address: addr)
        } catch {
            lookupError = UserErrors.message(error)
        }
    }

    private func tierColor(_ tier: Int) -> Color {
        switch tier {
        case 1: return PathPulseColor.mint26
        case 2: return PathPulseColor.mint58
        default: return PathPulseColor.mint
        }
    }
}
