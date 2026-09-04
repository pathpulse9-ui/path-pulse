import SwiftUI

/// PathPulse color palette. 1:1 mirror of Android's `ui/theme/Color.kt` — same hex
/// values, same alpha variants. If Android changes a color here, iOS must follow.
enum PathPulseColor {
    // Surfaces
    static let background = Color(hex: 0xF3F7F5)
    static let surface    = Color(hex: 0xFFFFFF)

    // Brand mint
    static let mint    = Color(hex: 0x03C394)
    static let mint58  = Color(hex: 0x03C394, opacity: 0x94 / 255.0) // 58%
    static let mint26  = Color(hex: 0x03C394, opacity: 0x42 / 255.0) // 26%
    static let mintInk = Color(hex: 0x032018)

    // Neutrals
    static let black    = Color(hex: 0x000000)
    static let white    = Color(hex: 0xFFFFFF)
    static let gray800  = Color(hex: 0x1F2937)
    static let black70  = Color.black.opacity(0xB3 / 255.0)
    static let black60  = Color.black.opacity(0x99 / 255.0)
    static let black50  = Color.black.opacity(0x80 / 255.0)
    static let black40  = Color.black.opacity(0x66 / 255.0)
    static let black15  = Color.black.opacity(0x26 / 255.0)
    static let black10  = Color.black.opacity(0x1A / 255.0)
    static let black05  = Color.black.opacity(0x0D / 255.0)
    static let black03  = Color.black.opacity(0x08 / 255.0)

    // Accents
    static let accentBlue  = Color(hex: 0x2563EB)
    static let accentAmber = Color(hex: 0xD97706)
    static let accentTeal  = Color(hex: 0x0D9488)

    // Blue scale
    static let blue50  = Color(hex: 0xEFF6FF)
    static let blue100 = Color(hex: 0xDBEAFE)
    static let blue300 = Color(hex: 0x93C5FD)
    static let blue700 = Color(hex: 0x1D4ED8)

    // Teal scale
    static let teal50  = Color(hex: 0xF0FDFA)
    static let teal700 = Color(hex: 0x0F766E)

    // Green scale
    static let green100 = Color(hex: 0xDCFCE7)
    static let green300 = Color(hex: 0x86EFAC)
    static let green500 = Color(hex: 0x22C55E)
    static let green700 = Color(hex: 0x15803D)

    // Red scale
    static let red100 = Color(hex: 0xFEE2E2)
    static let red300 = Color(hex: 0xFCA5A5)
    static let red500 = Color(hex: 0xEF4444)
    static let red600 = Color(hex: 0xDC2626)
    static let red700 = Color(hex: 0xB91C1C)
}

extension Color {
    /// Build a Color from a 24-bit RGB hex (`0xRRGGBB`), optional opacity.
    init(hex: UInt32, opacity: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >>  8) & 0xFF) / 255.0
        let b = Double( hex        & 0xFF) / 255.0
        self = Color(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }
}
