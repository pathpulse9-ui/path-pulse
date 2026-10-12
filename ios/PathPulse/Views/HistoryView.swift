import SwiftUI

/// Driver activity history: every off-ramp + on-ramp session, newest first,
/// filterable by direction + status. Tapping a row expands the per-session
/// status-event log (sourced from `off_ramp_status_events` for off-ramp,
/// a snapshot for on-ramp). Presented as a sheet from the Off-ramp tab so
/// it stays within the 5-tab shell.
struct HistoryView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var offSessions: [OffRampSession] = []
    @State private var onSessions: [OnRampSession] = []
    @State private var loading = false
    @State private var errorMessage: String? = nil
    @State private var direction: Direction = .all
    @State private var statusFilter: StatusFilter = .all
    @State private var expandedId: String? = nil

    private let data = DataRepository()

    enum Direction: String, CaseIterable, Identifiable {
        case all, off, on
        var id: String { rawValue }
        var label: String {
            switch self {
            case .all: return "All"
            case .off: return "Off-ramp"
            case .on:  return "On-ramp"
            }
        }
    }

    enum StatusFilter: String, CaseIterable, Identifiable {
        case all, awaitingTransfer, converting, completed, filled, partiallyFilled, cancelled, error
        var id: String { rawValue }
        var label: String {
            switch self {
            case .all:              return "All statuses"
            case .awaitingTransfer: return "Awaiting transfer"
            case .converting:       return "Converting"
            case .completed:        return "Completed"
            case .filled:           return "Filled"
            case .partiallyFilled:  return "Partially filled"
            case .cancelled:        return "Cancelled"
            case .error:            return "Error"
            }
        }
        var matches: Set<String> {
            switch self {
            case .all:              return []
            case .awaitingTransfer: return ["pending_user_transfer_start"]
            case .converting:       return ["pending_anchor"]
            case .completed:        return ["completed"]
            case .filled:           return ["filled"]
            case .partiallyFilled:  return ["partially_filled"]
            case .cancelled:        return ["cancelled", "partially_cancelled"]
            case .error:            return ["error"]
            }
        }
    }

    private struct Row: Identifiable, Hashable {
        let id: String
        let direction: Direction
        let status: String
        let amount: String
        let asset: String
        let fiatCurrency: String
        let fiatAmount: String?
        let settlementBatchId: String?
        let createdAt: String
    }

    private var rows: [Row] {
        var out: [Row] = []
        for s in offSessions {
            out.append(Row(
                id: s.id, direction: .off, status: s.status,
                amount: s.amount, asset: s.asset.code,
                fiatCurrency: s.fiatCurrency,
                fiatAmount: s.fiatAmountEstimate,
                settlementBatchId: s.settlementBatchId,
                createdAt: s.createdAt
            ))
        }
        for s in onSessions {
            out.append(Row(
                id: s.id, direction: .on, status: s.status,
                amount: s.amount, asset: "INR",
                fiatCurrency: s.asset,
                fiatAmount: s.cryptoAmount,
                settlementBatchId: nil,
                createdAt: s.createdAt
            ))
        }
        return out.sorted { $0.createdAt > $1.createdAt }
    }

    private var filtered: [Row] {
        rows.filter { r in
            if direction != .all, r.direction != direction { return false }
            if statusFilter != .all, !statusFilter.matches.contains(r.status.lowercased()) { return false }
            return true
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                PathPulseColor.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: PpSpace.md) {
                        if let errorMessage { PpErrorBanner(message: errorMessage) }
                        filterStrip
                        if loading && rows.isEmpty {
                            PpCard { Text("Loading your activity…")
                                .font(PathPulseFont.bodyMedium)
                                .foregroundStyle(PathPulseColor.black60) }
                        } else if filtered.isEmpty {
                            PpCard { Text("No activity in this filter.")
                                .font(PathPulseFont.bodyMedium)
                                .foregroundStyle(PathPulseColor.black60) }
                        } else {
                            PpCard {
                                VStack(spacing: 0) {
                                    ForEach(Array(filtered.enumerated()), id: \.element.id) { i, r in
                                        if i > 0 { PpDivider() }
                                        rowView(r)
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal, PpSize.screenPadding)
                    .padding(.bottom, PpSpace.xxl)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("History")
                        .font(PathPulseFont.labelLarge)
                        .foregroundStyle(PathPulseColor.black)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button(action: { dismiss() }) {
                        Image(systemName: "xmark").foregroundStyle(PathPulseColor.black)
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: { Task { await refresh() } }) {
                        if loading { ProgressView() } else {
                            Image(systemName: "arrow.clockwise").foregroundStyle(PathPulseColor.black)
                        }
                    }
                }
            }
        }
        .task { await refresh() }
        .refreshable { await refresh() }
    }

    @ViewBuilder private var filterStrip: some View {
        VStack(alignment: .leading, spacing: PpSpace.sm) {
            HStack(spacing: PpSpace.xs) {
                ForEach(Direction.allCases) { d in
                    Button(action: { direction = d }) {
                        Text(d.label)
                            .font(PathPulseFont.labelSmall)
                            .foregroundStyle(direction == d ? PathPulseColor.white : PathPulseColor.black70)
                            .padding(.horizontal, PpSpace.md)
                            .padding(.vertical, 6)
                            .background(direction == d ? PathPulseColor.black : PathPulseColor.surface)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(PathPulseColor.black05, lineWidth: 1))
                    }
                }
            }
            Picker("Status", selection: $statusFilter) {
                ForEach(StatusFilter.allCases) { s in
                    Text(s.label).tag(s)
                }
            }
            .pickerStyle(.menu)
            .tint(PathPulseColor.black)
        }
    }

    @ViewBuilder private func rowView(_ r: Row) -> some View {
        let isExpanded = expandedId == rowKey(r)
        VStack(alignment: .leading, spacing: 0) {
            Button(action: { expandedId = isExpanded ? nil : rowKey(r) }) {
                HStack(spacing: PpSpace.md) {
                    directionBadge(r.direction)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(r.amount) \(r.asset)")
                            .font(PathPulseFont.bodyMedium)
                            .foregroundStyle(PathPulseColor.black)
                        if let fiat = r.fiatAmount {
                            Text("\(r.direction == .off ? "→" : "=") \(fiat) \(r.fiatCurrency)")
                                .font(PathPulseFont.bodySmall)
                                .foregroundStyle(PathPulseColor.black50)
                        }
                        Text(formatDate(r.createdAt))
                            .font(PathPulseFont.labelSmall)
                            .foregroundStyle(PathPulseColor.black40)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 4) {
                        statusPill(r.status)
                        if let b = r.settlementBatchId {
                            Text("↳ \(shorten(b))")
                                .font(PathPulseFont.labelSmall)
                                .foregroundStyle(PathPulseColor.black40)
                                .monospaced()
                        }
                    }
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(PathPulseColor.black40)
                }
                .padding(.vertical, PpSpace.md)
            }
            .buttonStyle(.plain)

            if isExpanded {
                drilldown(r)
                    .padding(.bottom, PpSpace.md)
            }
        }
    }

    private func rowKey(_ r: Row) -> String { "\(r.direction.rawValue)-\(r.id)" }

    @ViewBuilder private func directionBadge(_ d: Direction) -> some View {
        let (bg, fg, img): (Color, Color, String) = d == .off
            ? (PathPulseColor.blue100, PathPulseColor.blue700, "arrow.up.right")
            : (PathPulseColor.green100, PathPulseColor.green700, "arrow.down.left")
        ZStack {
            Circle().fill(bg).frame(width: 36, height: 36)
            Image(systemName: img).foregroundStyle(fg)
        }
    }

    @ViewBuilder private func statusPill(_ s: String) -> some View {
        PpStatusPill(text: s.replacingOccurrences(of: "_", with: " "),
                     color: Color.ppOffRampStatus(s))
    }

    @ViewBuilder private func drilldown(_ r: Row) -> some View {
        if r.direction == .off {
            OffRampEventLog(data: data, sessionId: r.id)
        } else {
            OnRampSnapshot(data: data, sessionId: r.id)
        }
    }

    @MainActor
    private func refresh() async {
        loading = true; errorMessage = nil
        defer { loading = false }
        do {
            async let off = data.offRampSessions(limit: 200)
            async let on  = data.onRampSessions(limit: 200)
            offSessions = try await off.items
            onSessions  = (try? await on.items) ?? []
        } catch {
            errorMessage = UserErrors.message(error)
        }
    }

    private func formatDate(_ iso: String) -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var date = fmt.date(from: iso)
        if date == nil {
            fmt.formatOptions = [.withInternetDateTime]
            date = fmt.date(from: iso)
        }
        guard let d = date else { return String(iso.prefix(16)) }
        let out = DateFormatter()
        out.dateStyle = .medium
        out.timeStyle = .short
        return out.string(from: d)
    }

    private func shorten(_ s: String) -> String {
        guard s.count > 12 else { return s }
        return "\(s.prefix(6))…\(s.suffix(4))"
    }
}

// MARK: - Event log + on-ramp snapshot

private struct OffRampEventLog: View {
    let data: DataRepository
    let sessionId: String

    @State private var events: [OffRampStatusEvent]? = nil
    @State private var errorMessage: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: PpSpace.sm) {
            if let errorMessage {
                Text(errorMessage)
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.red700)
            } else if events == nil {
                Text("Loading event log…")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
            } else if let events, events.isEmpty {
                Text("No events recorded.")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
            } else if let events {
                Text("Status events (\(events.count)) — append-only, source-tagged")
                    .font(PathPulseFont.labelSmall)
                    .foregroundStyle(PathPulseColor.black50)
                ForEach(Array(events.enumerated()), id: \.element.id) { i, e in
                    HStack(spacing: PpSpace.sm) {
                        Text("\(i + 1).")
                            .font(PathPulseFont.labelSmall)
                            .foregroundStyle(PathPulseColor.black40)
                            .frame(width: 20, alignment: .trailing)
                        Text(e.source)
                            .font(PathPulseFont.labelSmall)
                            .foregroundStyle(sourceInk(e.source))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(sourceBg(e.source))
                            .clipShape(Capsule())
                        Text(e.mappedStatus ?? "(no status change)")
                            .font(PathPulseFont.bodySmall)
                            .foregroundStyle(PathPulseColor.black70)
                            .monospaced()
                        if let c = e.carretStatus {
                            Text("← \(c)")
                                .font(PathPulseFont.bodySmall)
                                .foregroundStyle(PathPulseColor.black40)
                        }
                        Spacer()
                    }
                }
            }
        }
        .padding(PpSpace.md)
        .background(PathPulseColor.background)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .task {
            do { events = try await data.offRampSessionEvents(id: sessionId).events }
            catch { errorMessage = UserErrors.message(error) }
        }
    }

    private func sourceBg(_ s: String) -> Color {
        switch s {
        case "placed", "create": return PathPulseColor.black05
        case "webhook":          return PathPulseColor.blue100
        case "poll":             return PathPulseColor.accentAmber.opacity(0.18)
        case "reconciler":       return PathPulseColor.mint26
        case "client":           return PathPulseColor.accentAmber.opacity(0.28)
        default:                 return PathPulseColor.black05
        }
    }
    private func sourceInk(_ s: String) -> Color {
        switch s {
        case "webhook":    return PathPulseColor.blue700
        case "reconciler": return PathPulseColor.mintInk
        default:           return PathPulseColor.black70
        }
    }
}

private struct OnRampSnapshot: View {
    let data: DataRepository
    let sessionId: String

    @State private var session: OnRampSession? = nil
    @State private var errorMessage: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: PpSpace.xs) {
            if let errorMessage {
                Text(errorMessage).font(PathPulseFont.bodySmall).foregroundStyle(PathPulseColor.red700)
            } else if let session {
                HStack {
                    Text("Order id")
                    Spacer()
                    Text(session.id).monospaced()
                }
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black60)
                if let b = session.bankLast4 {
                    HStack {
                        Text("Debited from")
                        Spacer()
                        Text("••\(b)")
                    }
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black60)
                }
                HStack {
                    Text("Status")
                    Spacer()
                    Text(session.status.replacingOccurrences(of: "_", with: " "))
                }
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black60)
            } else {
                Text("Loading session…")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
            }
        }
        .padding(PpSpace.md)
        .background(PathPulseColor.background)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .task {
            do { session = try await data.onRampSession(id: sessionId) }
            catch { errorMessage = UserErrors.message(error) }
        }
    }
}
