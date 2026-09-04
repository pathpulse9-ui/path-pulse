import SwiftUI

/// Rounded-corner constants — mirror Android's `PpShapes` in `ui/theme/Theme.kt`.
enum PpRadius {
    static let xs: CGFloat = 8
    static let sm: CGFloat = 12
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 28

    static let pill:  CGFloat = 999  // effectively fully rounded
    static let card:  CGFloat = 28
    static let tile:  CGFloat = 12
    static let badge: CGFloat = 10
}

extension View {
    /// `.ppCardShape()` = 28pt rounded corners with clipping. Convenience for the
    /// most common surface treatment across the app.
    func ppCardShape() -> some View {
        clipShape(RoundedRectangle(cornerRadius: PpRadius.card, style: .continuous))
    }

    func ppTileShape() -> some View {
        clipShape(RoundedRectangle(cornerRadius: PpRadius.tile, style: .continuous))
    }

    func ppPillShape() -> some View {
        clipShape(Capsule())
    }
}
