import SwiftUI

/// PathPulse typography. Mirrors Android's `ui/theme/Type.kt` (`PpTypography`).
/// Uses SF Pro (`.system`) which parallels Android's `FontFamily.SansSerif`.
///
/// Sizes are pt (iOS) matching Android sp values 1:1; line-heights are set via
/// `.lineSpacing` at the call site when needed. Letter-spacing (`kerning`) matches
/// Android's negative letterSpacing on display/headline sizes.
enum PathPulseFont {
    static let displayMedium   = Font.system(size: 36, weight: .medium)
    static let displaySmall    = Font.system(size: 32, weight: .medium)
    static let headlineMedium  = Font.system(size: 28, weight: .medium)
    static let headlineSmall   = Font.system(size: 22, weight: .medium)
    static let titleLarge      = Font.system(size: 20, weight: .medium)
    static let titleMedium     = Font.system(size: 16, weight: .medium)
    static let bodyLarge       = Font.system(size: 16, weight: .regular)
    static let bodyMedium      = Font.system(size: 14, weight: .regular)
    static let bodySmall       = Font.system(size: 12, weight: .regular)
    static let labelLarge      = Font.system(size: 14, weight: .medium)
    static let labelMedium     = Font.system(size: 12, weight: .medium)
    static let labelSmall      = Font.system(size: 10, weight: .medium)
}

extension Text {
    /// Convenience: `Text("…").pathPulseKerning(.displayMedium)` applies Android's
    /// tighter tracking on display/headline sizes. Body sizes keep default tracking.
    func pathPulseKerning(_ scale: PpKerning) -> Text {
        kerning(scale.rawValue)
    }
}

enum PpKerning: CGFloat {
    case displayMedium   = -1.08
    case displaySmall    = -0.96
    case headlineMedium  = -0.84
    case headlineSmall   = -0.44
    case titleLarge      = -0.40
    case titleMedium     = -0.32
    case none            =  0
}
