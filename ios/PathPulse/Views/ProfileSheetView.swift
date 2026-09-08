import SwiftUI

/// Bottom-sheet profile card — mirrors Android's `ui/ProfileSheet.kt`.
/// Shows session label, method badge, managed wallet address (if any),
/// and a sign-out row.
struct ProfileSheetView: View {
    let user: SessionUser
    let onSignOut: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.bottom, PpSpace.lg)

            if let address = user.address {
                walletTile(address: address)
                    .padding(.bottom, PpSpace.lg)
            }

            Divider().background(PathPulseColor.black05)

            signOutRow
                .padding(.top, PpSpace.md)
        }
        .padding(.horizontal, PpSize.screenPadding)
        .padding(.top, PpSpace.lg)
        .padding(.bottom, PpSpace.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PathPulseColor.surface)
    }

    // MARK: - Sections

    @ViewBuilder
    private var header: some View {
        HStack(spacing: PpSpace.md) {
            Text(String(sessionLabel.prefix(1)).uppercased())
                .font(PathPulseFont.labelLarge)
                .foregroundStyle(PathPulseColor.mintInk)
                .frame(width: 44, height: 44)
                .background(PathPulseColor.mint)
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 2) {
                Text(sessionLabel)
                    .font(PathPulseFont.titleMedium)
                    .foregroundStyle(PathPulseColor.black)
                    .lineLimit(1)
                Text("Signed in with \(methodLabel)")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
            }

            Spacer()

            methodBadge
        }
    }

    @ViewBuilder
    private func walletTile(address: String) -> some View {
        VStack(alignment: .leading, spacing: PpSpace.xs) {
            Text("Managed wallet")
                .font(PathPulseFont.labelMedium)
                .foregroundStyle(PathPulseColor.black40)
            Text(address)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(PathPulseColor.black70)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(PpSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PathPulseColor.black05)
        .ppTileShape()
    }

    @ViewBuilder
    private var methodBadge: some View {
        Text(methodLabel)
            .font(PathPulseFont.labelSmall)
            .foregroundStyle(PathPulseColor.black70)
            .padding(.horizontal, PpSpace.sm)
            .padding(.vertical, PpSpace.xs)
            .background(PathPulseColor.black05)
            .clipShape(Capsule())
    }

    @ViewBuilder
    private var signOutRow: some View {
        Button(action: onSignOut) {
            HStack(spacing: PpSpace.md) {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(PathPulseColor.black)
                Text(user.method == "guest" ? "Exit guest session" : "Sign out")
                    .font(PathPulseFont.labelLarge)
                    .foregroundStyle(PathPulseColor.black)
                Spacer()
            }
            .padding(.horizontal, PpSpace.md)
            .frame(height: PpSize.control)
            .frame(maxWidth: .infinity, alignment: .leading)
            .ppTileShape()
        }
        .buttonStyle(.plain)
    }

    // MARK: - Formatting

    private var sessionLabel: String {
        if let email = user.email { return email }
        if let addr = user.address { return "\(addr.prefix(6))…\(addr.suffix(4))" }
        return "Guest session"
    }

    private var methodLabel: String {
        switch user.method {
        case "google": return "Google"
        case "wallet": return "Wallet"
        case "guest":  return "Guest"
        default:       return user.method.capitalized
        }
    }
}

#Preview("Google") {
    ProfileSheetView(
        user: SessionUser(userId: "u", method: "google", email: "aditya@pathpulse.ai",
                          address: "GDABC1234567890XYZLMNOPQRSTUVWXYZ0987654321"),
        onSignOut: {}
    )
}

#Preview("Guest") {
    ProfileSheetView(
        user: SessionUser(userId: "u", method: "guest", email: nil, address: nil),
        onSignOut: {}
    )
}
