import SwiftUI

/// 5-tab shell — mirrors Android's `shell/AppShell.kt`.
///
/// Layout: top bar with core-status pill + avatar → tab content → floating pill
/// bottom nav with 5 items. Tapping the avatar opens `ProfileSheetView`.
struct AppShellView: View {
    @EnvironmentObject private var state: AppState

    @State private var health: HealthResponse? = nil
    @State private var profileOpen = false

    var body: some View {
        ZStack {
            PathPulseColor.background.ignoresSafeArea()

            VStack(spacing: 0) {
                topBar
                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                bottomNav
            }
        }
        .task { await refreshHealth() }
        .sheet(isPresented: $profileOpen) {
            if let user = state.user {
                ProfileSheetView(
                    user: user,
                    onSignOut: {
                        profileOpen = false
                        Task { await state.signOut() }
                    }
                )
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
            }
        }
    }

    // MARK: - Top bar

    @ViewBuilder
    private var topBar: some View {
        HStack(spacing: 0) {
            statusPill
            Spacer()
            avatarButton
        }
        .padding(.horizontal, PpSize.screenPadding)
        .frame(height: PpSize.topBar)
        .background(PathPulseColor.background)
    }

    @ViewBuilder
    private var statusPill: some View {
        HStack(spacing: PpSpace.sm) {
            Circle()
                .fill(health != nil ? PathPulseColor.green500 : PathPulseColor.red500)
                .frame(width: 8, height: 8)
            Text(health != nil ? "Core · \(health!.network)" : "Core unreachable")
                .font(PathPulseFont.labelSmall)
                .foregroundStyle(PathPulseColor.black70)
        }
        .padding(.horizontal, PpSpace.md)
        .padding(.vertical, PpSpace.sm)
        .background(PathPulseColor.surface)
        .clipShape(Capsule())
    }

    @ViewBuilder
    private var avatarButton: some View {
        Button {
            profileOpen = true
        } label: {
            Text(avatarInitial)
                .font(PathPulseFont.labelLarge)
                .foregroundStyle(PathPulseColor.mintInk)
                .frame(width: PpSize.avatar, height: PpSize.avatar)
                .background(PathPulseColor.mint)
                .clipShape(Circle())
        }
    }

    private var avatarInitial: String {
        guard let user = state.user else { return "G" }
        if let email = user.email, let first = email.first { return String(first).uppercased() }
        if let addr = user.address, let first = addr.first { return String(first).uppercased() }
        return "G"
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        switch state.selectedTab {
        case .dashboard:  DashboardView()
        case .settlement: SettlementView()
        case .scout:      ScoutView()
        case .offRamp:    OffRampView()
        case .treasury:   TreasuryView()
        }
    }

    // MARK: - Bottom nav

    @ViewBuilder
    private var bottomNav: some View {
        HStack(spacing: PpSpace.xs) {
            ForEach(AppTab.allCases) { tab in
                NavItem(
                    tab: tab,
                    selected: tab == state.selectedTab,
                    action: { state.selectedTab = tab }
                )
                .frame(maxWidth: .infinity)
            }
        }
        .padding(PpSpace.xs)
        .background(PathPulseColor.surface)
        .clipShape(Capsule())
        .padding(.horizontal, PpSize.screenPadding)
        .padding(.bottom, PpSpace.md)
    }

    private struct NavItem: View {
        let tab: AppTab
        let selected: Bool
        let action: () -> Void

        var body: some View {
            Button(action: action) {
                VStack(spacing: PpSpace.xs) {
                    Image(systemName: tab.systemImage)
                        .font(.system(size: 18, weight: .medium))
                    Text(tab.label)
                        .font(PathPulseFont.labelSmall)
                        .lineLimit(1)
                }
                .foregroundStyle(selected ? PathPulseColor.mintInk : PathPulseColor.black40)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(selected ? PathPulseColor.mint : Color.clear)
                .ppTileShape()
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Data

    private func refreshHealth() async {
        health = try? await DataRepository().health()
    }
}

/// Simple placeholder tab body — the mobile app is read-first for v1, so most
/// tabs point users at the web console for write actions.
struct PlaceholderTabView: View {
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

#Preview("Shell") {
    let s = AppState()
    s.user = SessionUser(userId: "u", method: "guest", email: nil, address: nil)
    return AppShellView().environmentObject(s)
}
