import CoreGraphics

/// Spacing scale — 1:1 mirror of Android's `PpSpace` in `ui/theme/Dimens.kt`.
enum PpSpace {
    static let xs:   CGFloat = 4
    static let sm:   CGFloat = 8
    static let md:   CGFloat = 12
    static let lg:   CGFloat = 16
    static let xl:   CGFloat = 20
    static let xxl:  CGFloat = 24
    static let xxxl: CGFloat = 32
}

/// Component sizing — mirrors Android's `PpSize`.
enum PpSize {
    static let screenPadding: CGFloat = 16
    static let cardPadding:   CGFloat = 20
    static let control:       CGFloat = 48
    static let topBar:        CGFloat = 64
    static let bottomNav:     CGFloat = 64
    static let avatar:        CGFloat = 32
    static let badge:         CGFloat = 36
    static let chartHeight:   CGFloat = 160
}
