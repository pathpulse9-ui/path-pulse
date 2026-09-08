import SwiftUI

/// Dashboard tab — mirrors Android's `ui/DashboardScreen.kt`.
///
/// Layout, top → bottom:
///   1. Header: "Dashboard" + Refresh button
///   2. Hero card: total gross (large) + batch count + 7-day stacked bar chart + legend
///   3. 2×2 stat tiles: Authorities / Driver rewards / Treasury / Driver payouts count
///   4. Split composition card: single horizontal stacked bar + amounts + percentages
///   5. Recent activity: last N batches then last N off-ramp sessions with badges
struct DashboardView: View {
    @State private var batches: [SettlementBatch] = []
    @State private var sessions: [OffRampSession] = []
    @State private var loading = false
    @State private var errorMessage: String? = nil
    @State private var selectedDay: Int? = nil

    private let data = DataRepository()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PpSpace.md) {
                header
                if let errorMessage {
                    card {
                        Text(errorMessage)
                            .font(PathPulseFont.bodyMedium)
                            .foregroundStyle(PathPulseColor.red600)
                    }
                }
                heroCard
                statTiles
                splitCompositionCard
                recentActivityCard
            }
            .padding(.horizontal, PpSize.screenPadding)
            .padding(.bottom, PpSpace.xxl)
        }
        .background(PathPulseColor.background)
        .task { await refresh() }
        .refreshable { await refresh() }
    }

    // MARK: - Refresh

    @MainActor
    private func refresh() async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        do {
            async let b = data.settlementBatches(limit: 50)
            async let s = data.offRampSessions(limit: 50)
            let (bp, sp) = try await (b, s)
            batches = bp.items
            sessions = sp.items
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Derived data

    private var totals: (auth: Double, driver: Double, treasury: Double, gross: Double) {
        var a = 0.0, d = 0.0, t = 0.0, g = 0.0
        for b in batches {
            a += Double(b.split.authorities) ?? 0
            d += Double(b.split.driverRewards) ?? 0
            t += Double(b.split.treasury) ?? 0
            g += Double(b.grossAmount) ?? 0
        }
        return (a, d, t, g)
    }

    private var driverPayoutCount: Int {
        batches.reduce(0) { $0 + $1.driverPayouts.count }
    }

    private var days: [DayBucket] {
        var map: [String: [Double]] = [:]
        var order: [String] = []
        for b in batches {
            let day = String(b.createdAt.prefix(10))
            if map[day] == nil { map[day] = [0, 0, 0]; order.append(day) }
            map[day]![0] += Double(b.split.authorities) ?? 0
            map[day]![1] += Double(b.split.driverRewards) ?? 0
            map[day]![2] += Double(b.split.treasury) ?? 0
        }
        return order.sorted().suffix(7).map { day in
            let v = map[day]!
            return DayBucket(day: day, label: weekdayLabel(day), values: v, total: v.reduce(0, +))
        }
    }

    private var peak: Double { days.map(\.total).max() ?? 0 }

    // MARK: - Header

    @ViewBuilder
    private var header: some View {
        HStack {
            Text("Dashboard")
                .font(PathPulseFont.headlineMedium)
                .pathPulseKerning(.headlineMedium)
                .foregroundStyle(PathPulseColor.black)
            Spacer()
            Button {
                Task { await refresh() }
            } label: {
                HStack(spacing: PpSpace.xs) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 13, weight: .medium))
                    Text(loading ? "Refreshing…" : "Refresh")
                        .font(PathPulseFont.labelMedium)
                }
                .foregroundStyle(loading ? PathPulseColor.black40 : PathPulseColor.black)
                .padding(.horizontal, PpSpace.md)
                .padding(.vertical, PpSpace.sm)
                .background(
                    Capsule()
                        .stroke(PathPulseColor.black15, lineWidth: 1)
                        .background(PathPulseColor.surface.clipShape(Capsule()))
                )
            }
            .disabled(loading)
        }
        .padding(.top, PpSpace.sm)
    }

    // MARK: - Hero card (total + 7-day chart)

    @ViewBuilder
    private var heroCard: some View {
        card {
            HStack(alignment: .bottom, spacing: 0) {
                Text(fmt(totals.gross))
                    .font(PathPulseFont.displaySmall)
                    .foregroundStyle(PathPulseColor.black)
                Text(" XLM")
                    .font(PathPulseFont.titleLarge)
                    .foregroundStyle(PathPulseColor.black40)
                    .padding(.bottom, 3)
            }
            Text("Settled across \(batches.count) batch\(batches.count == 1 ? "" : "es")")
                .font(PathPulseFont.bodyMedium)
                .foregroundStyle(PathPulseColor.black50)
                .padding(.top, PpSpace.xs)

            if days.isEmpty {
                emptyState(
                    title: "No settlement activity yet",
                    message: "Run a settlement batch and this chart fills from on-chain results."
                )
                .padding(.top, PpSpace.xl)
            } else {
                SettlementChart(days: days, peak: peak, selected: $selectedDay)
                    .padding(.top, PpSpace.xl)

                if let idx = selectedDay, let detail = days[safe: idx] {
                    daySelectionDetail(detail: detail)
                        .padding(.top, PpSpace.lg)
                } else {
                    HStack(spacing: PpSpace.md) {
                        ForEach(Series.all, id: \.label) { s in
                            HStack(spacing: PpSpace.sm) {
                                Circle().fill(s.color).frame(width: 8, height: 8)
                                Text(s.label)
                                    .font(PathPulseFont.bodySmall)
                                    .foregroundStyle(PathPulseColor.black50)
                            }
                        }
                    }
                    .padding(.top, PpSpace.lg)
                }
            }
        }
    }

    @ViewBuilder
    private func daySelectionDetail(detail: DayBucket) -> some View {
        VStack(alignment: .leading, spacing: PpSpace.sm) {
            Text(detail.day)
                .font(PathPulseFont.labelMedium)
                .foregroundStyle(PathPulseColor.black50)
            ForEach(Array(Series.all.enumerated()), id: \.offset) { i, s in
                HStack {
                    Circle().fill(s.color).frame(width: 8, height: 8)
                    Text(s.label)
                        .font(PathPulseFont.bodySmall)
                        .foregroundStyle(PathPulseColor.black70)
                        .padding(.leading, PpSpace.sm)
                    Spacer()
                    Text(fmt(detail.values[i]))
                        .font(PathPulseFont.bodySmall)
                        .foregroundStyle(PathPulseColor.black)
                }
            }
        }
        .padding(PpSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PathPulseColor.black05)
        .ppTileShape()
    }

    // MARK: - 2×2 stat tiles

    @ViewBuilder
    private var statTiles: some View {
        VStack(spacing: PpSpace.md) {
            HStack(spacing: PpSpace.md) {
                statTile(series: Series.all[0], value: totals.auth)
                statTile(series: Series.all[1], value: totals.driver)
            }
            HStack(spacing: PpSpace.md) {
                statTile(series: Series.all[2], value: totals.treasury)
                card {
                    Text("Driver payouts")
                        .font(PathPulseFont.bodySmall)
                        .foregroundStyle(PathPulseColor.black50)
                    Text("\(driverPayoutCount)")
                        .font(PathPulseFont.titleLarge)
                        .foregroundStyle(PathPulseColor.black)
                        .padding(.top, PpSpace.xs)
                }
            }
        }
    }

    @ViewBuilder
    private func statTile(series: Series, value: Double) -> some View {
        card {
            HStack(spacing: 6) {
                Circle().fill(series.color).frame(width: 8, height: 8)
                Text(series.pct)
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black50)
            }
            Text(series.label)
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black50)
                .padding(.top, 2)
            Text(fmt(value))
                .font(PathPulseFont.titleLarge)
                .foregroundStyle(PathPulseColor.black)
                .padding(.top, PpSpace.xs)
        }
    }

    // MARK: - Split composition card

    @ViewBuilder
    private var splitCompositionCard: some View {
        card {
            cardHeader(title: "Split composition", subtitle: "Share of all settled volume to date.")
            if totals.gross == 0 {
                Text("No volume settled yet.")
                    .font(PathPulseFont.bodyMedium)
                    .foregroundStyle(PathPulseColor.black40)
                    .padding(.top, PpSpace.lg)
            } else {
                GeometryReader { geo in
                    HStack(spacing: 2) {
                        ForEach(Array(Series.all.enumerated()), id: \.offset) { i, s in
                            let width = share(i) * (geo.size.width - 4)
                            if width > 0 {
                                Rectangle()
                                    .fill(s.color)
                                    .frame(width: width, height: 12)
                            }
                        }
                    }
                    .clipShape(Capsule())
                }
                .frame(height: 12)
                .padding(.top, PpSpace.lg)

                VStack(spacing: PpSpace.md) {
                    ForEach(Array(Series.all.enumerated()), id: \.offset) { i, s in
                        HStack {
                            Circle().fill(s.color).frame(width: 8, height: 8)
                            Text(s.label)
                                .font(PathPulseFont.bodyMedium)
                                .foregroundStyle(PathPulseColor.black70)
                                .padding(.leading, PpSpace.md)
                            Spacer()
                            Text("\(fmt(value(i))) XLM")
                                .font(PathPulseFont.bodySmall)
                                .foregroundStyle(PathPulseColor.black50)
                            Text(String(format: "%.1f%%", share(i) * 100))
                                .font(PathPulseFont.bodyMedium)
                                .foregroundStyle(PathPulseColor.black)
                                .frame(width: 48, alignment: .trailing)
                                .padding(.leading, PpSpace.md)
                        }
                    }
                }
                .padding(.top, PpSpace.lg)
            }
        }
    }

    private func value(_ i: Int) -> Double {
        switch i {
        case 0: return totals.auth
        case 1: return totals.driver
        default: return totals.treasury
        }
    }

    private func share(_ i: Int) -> Double {
        guard totals.gross > 0 else { return 0 }
        return value(i) / totals.gross
    }

    // MARK: - Recent activity

    @ViewBuilder
    private var recentActivityCard: some View {
        card {
            cardHeader(title: "Recent activity")
            if batches.isEmpty && sessions.isEmpty {
                Text("Nothing settled or withdrawn yet.")
                    .font(PathPulseFont.bodyMedium)
                    .foregroundStyle(PathPulseColor.black40)
                    .padding(.top, PpSpace.lg)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(batches.prefix(4).enumerated()), id: \.offset) { i, b in
                        if i > 0 { rowDivider }
                        ActivityRow(
                            code: "ST",
                            badgeBg: PathPulseColor.blue50,
                            badgeFg: PathPulseColor.blue700,
                            title: "Settlement batch",
                            subtitle: shortHash(b.txHash),
                            monospaceSubtitle: true,
                            amount: "\(fmt(Double(b.grossAmount) ?? 0)) XLM",
                            date: String(b.createdAt.prefix(10))
                        )
                    }
                    ForEach(Array(sessions.prefix(4).enumerated()), id: \.offset) { i, s in
                        if !batches.isEmpty || i > 0 { rowDivider }
                        ActivityRow(
                            code: "OR",
                            badgeBg: PathPulseColor.teal50,
                            badgeFg: PathPulseColor.teal700,
                            title: "Off-ramp · \(s.fiatCurrency)",
                            subtitle: s.status.replacingOccurrences(of: "_", with: " "),
                            monospaceSubtitle: false,
                            amount: "\(fmt(Double(s.amount) ?? 0)) \(s.asset.code)",
                            date: String(s.createdAt.prefix(10))
                        )
                    }
                }
                .padding(.top, PpSpace.sm)
            }
        }
    }

    // MARK: - Reusables

    @ViewBuilder
    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .padding(PpSize.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PathPulseColor.surface)
        .ppCardShape()
    }

    @ViewBuilder
    private func cardHeader(title: String, subtitle: String? = nil) -> some View {
        Text(title)
            .font(PathPulseFont.titleMedium)
            .foregroundStyle(PathPulseColor.black)
        if let subtitle {
            Text(subtitle)
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black50)
                .padding(.top, 2)
        }
    }

    @ViewBuilder
    private func emptyState(title: String, message: String) -> some View {
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
    }

    private var rowDivider: some View {
        Rectangle().fill(PathPulseColor.black05).frame(height: 1)
    }
}

// MARK: - Series (chart colors)

private struct Series {
    let label: String
    let pct: String
    let color: Color

    static let all: [Series] = [
        Series(label: "Authorities",    pct: "50%", color: PathPulseColor.mint),
        Series(label: "Driver rewards", pct: "30%", color: PathPulseColor.mint58),
        Series(label: "Treasury",       pct: "20%", color: PathPulseColor.mint26),
    ]
}

// MARK: - 7-day stacked bar chart

private struct DayBucket {
    let day: String   // YYYY-MM-DD
    let label: String // "Mon" / "Tue" / ...
    let values: [Double]
    let total: Double
}

private struct SettlementChart: View {
    let days: [DayBucket]
    let peak: Double
    @Binding var selected: Int?

    var body: some View {
        HStack(alignment: .bottom, spacing: PpSpace.sm) {
            ForEach(Array(days.enumerated()), id: \.offset) { i, d in
                barColumn(i: i, day: d)
            }
        }
        .frame(height: PpSize.chartHeight)
    }

    @ViewBuilder
    private func barColumn(i: Int, day d: DayBucket) -> some View {
        let dimmed = selected != nil && selected != i
        let fraction = peak > 0 ? max(0.02, min(1.0, d.total / peak)) : 0.02

        VStack(spacing: PpSpace.sm) {
            GeometryReader { geo in
                let colH = geo.size.height
                let barH = colH * fraction
                VStack(spacing: 0) {
                    Spacer(minLength: 0)
                    VStack(spacing: 0) {
                        ForEach(Array(Series.all.enumerated()), id: \.offset) { si, s in
                            let v = d.values[si]
                            if v > 0 {
                                Rectangle()
                                    .fill(s.color.opacity(dimmed ? 0.4 : 1.0))
                                    .frame(height: barH * (v / d.total))
                            }
                        }
                    }
                    .frame(height: barH)
                    .clipShape(RoundedCorner(radius: 4, corners: [.topLeft, .topRight]))
                }
                .frame(maxWidth: .infinity)
            }
            Text(d.label)
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(selected == i ? PathPulseColor.black70 : PathPulseColor.black40)
        }
        .contentShape(Rectangle())
        .onTapGesture { selected = (selected == i) ? nil : i }
    }
}

private struct RoundedCorner: Shape {
    var radius: CGFloat = 0
    var corners: UIRectCorner = .allCorners

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}

// MARK: - Activity row

private struct ActivityRow: View {
    let code: String
    let badgeBg: Color
    let badgeFg: Color
    let title: String
    let subtitle: String
    let monospaceSubtitle: Bool
    let amount: String
    let date: String

    var body: some View {
        HStack(spacing: PpSpace.md) {
            Text(code)
                .font(PathPulseFont.labelSmall)
                .foregroundStyle(badgeFg)
                .frame(width: 36, height: 36)
                .background(badgeBg)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(PathPulseFont.bodyMedium)
                    .foregroundStyle(PathPulseColor.black)
                    .lineLimit(1)
                Text(subtitle)
                    .font(monospaceSubtitle ? .system(.caption, design: .monospaced) : PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
                    .lineLimit(1)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text(amount)
                    .font(PathPulseFont.bodyMedium)
                    .foregroundStyle(PathPulseColor.black)
                Text(date)
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
            }
        }
        .padding(.vertical, PpSpace.md)
    }
}

// MARK: - Formatting helpers

private func fmt(_ n: Double) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.minimumFractionDigits = 2
    f.maximumFractionDigits = 2
    return f.string(from: NSNumber(value: n)) ?? String(format: "%.2f", n)
}

private func shortHash(_ a: String) -> String {
    a.count <= 12 ? a : "\(a.prefix(6))…\(a.suffix(4))"
}

private let WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

private func weekdayLabel(_ iso: String) -> String {
    let df = DateFormatter()
    df.dateFormat = "yyyy-MM-dd"
    df.timeZone = TimeZone(identifier: "UTC")
    guard let date = df.date(from: iso) else { return "—" }
    let cal = Calendar(identifier: .gregorian)
    let weekday = cal.component(.weekday, from: date) // 1 = Sunday
    return WEEKDAYS[(weekday - 1 + 7) % 7]
}

// MARK: - Safe subscript

private extension Array {
    subscript(safe idx: Int) -> Element? {
        indices.contains(idx) ? self[idx] : nil
    }
}

#Preview("Dashboard") {
    DashboardView()
}
