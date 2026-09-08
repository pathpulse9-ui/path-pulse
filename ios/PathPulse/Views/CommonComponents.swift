import SwiftUI

/// Shared building blocks used across tab views — consistent card treatment,
/// section headers, and the Refresh pill button.

struct PpCard<Content: View>: View {
    var padding: CGFloat = PpSize.cardPadding
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content() }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PathPulseColor.surface)
            .ppCardShape()
    }
}

struct PpTabHeader: View {
    let title: String
    let refreshing: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack {
            Text(title)
                .font(PathPulseFont.headlineMedium)
                .pathPulseKerning(.headlineMedium)
                .foregroundStyle(PathPulseColor.black)
            Spacer()
            Button(action: onRefresh) {
                HStack(spacing: PpSpace.xs) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 13, weight: .medium))
                    Text(refreshing ? "Refreshing…" : "Refresh")
                        .font(PathPulseFont.labelMedium)
                }
                .foregroundStyle(refreshing ? PathPulseColor.black40 : PathPulseColor.black)
                .padding(.horizontal, PpSpace.md)
                .padding(.vertical, PpSpace.sm)
                .background(
                    Capsule()
                        .stroke(PathPulseColor.black15, lineWidth: 1)
                        .background(PathPulseColor.surface.clipShape(Capsule()))
                )
            }
            .disabled(refreshing)
        }
        .padding(.top, PpSpace.sm)
    }
}

struct PpCardHeader: View {
    let title: String
    var subtitle: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(PathPulseFont.titleMedium)
                .foregroundStyle(PathPulseColor.black)
            if let subtitle {
                Text(subtitle)
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black50)
            }
        }
    }
}

struct PpEmptyState: View {
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: PpSpace.xs) {
            Text(title)
                .font(PathPulseFont.bodyMedium)
                .foregroundStyle(PathPulseColor.black70)
            Text(message)
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black40)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, PpSpace.xl)
    }
}

struct PpErrorBanner: View {
    let message: String

    var body: some View {
        PpCard {
            Text(message)
                .font(PathPulseFont.bodyMedium)
                .foregroundStyle(PathPulseColor.red600)
        }
    }
}

struct PpStatusPill: View {
    let text: String
    let color: Color

    var body: some View {
        HStack(spacing: PpSpace.xs) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(text)
                .font(PathPulseFont.labelSmall)
                .foregroundStyle(PathPulseColor.black70)
        }
        .padding(.horizontal, PpSpace.md)
        .padding(.vertical, PpSpace.xs)
        .background(color.opacity(0.12))
        .clipShape(Capsule())
    }
}

struct PpMonospaceAddress: View {
    let address: String
    var truncated: Bool = true

    var body: some View {
        Text(truncated ? "\(address.prefix(6))…\(address.suffix(6))" : address)
            .font(.system(.footnote, design: .monospaced))
            .foregroundStyle(PathPulseColor.black70)
    }
}

struct PpDivider: View {
    var body: some View {
        Rectangle().fill(PathPulseColor.black05).frame(height: 1)
    }
}

extension Color {
    /// Colored status-pill lookup mirroring Android's `statusColor()`.
    static func ppOffRampStatus(_ status: String) -> Color {
        let s = status.lowercased()
        if s.contains("fill") || s.contains("complete") || s.contains("success") {
            return PathPulseColor.green500
        }
        if s.contains("fail") || s.contains("cancel") || s.contains("reject") {
            return PathPulseColor.red500
        }
        return PathPulseColor.accentAmber
    }
}
