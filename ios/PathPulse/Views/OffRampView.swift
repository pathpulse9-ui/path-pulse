import SwiftUI

/// Off-ramp tab.
///
/// State-aware header — pre-KYC shows a "Verify your identity" banner that
/// launches the KYC wizard; post-KYC (or once we've adopted a mapping)
/// shows a "New withdrawal" primary CTA that opens the withdrawal sheet.
/// The sheet walks: amount → quote → confirm → success.
struct OffRampView: View {
    @State private var sessions: [OffRampSession] = []
    @State private var loading = false
    @State private var errorMessage: String? = nil
    @State private var limits: CarretLimits? = nil
    @State private var resume: CarretResumeResponse? = nil
    @State private var kycSheetOpen = false
    @State private var withdrawSheetOpen = false

    private let data = DataRepository()

    private var kycVerified: Bool { resume?.kycStatus == "verified" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PpSpace.md) {
                PpTabHeader(title: "Off-ramp", refreshing: loading, onRefresh: { Task { await refresh() } })
                if let errorMessage { PpErrorBanner(message: errorMessage) }

                if kycVerified {
                    verifiedHeader
                } else {
                    kycBanner
                }

                if let l = limits {
                    limitsChip(l)
                }

                PpCard {
                    PpCardHeader(
                        title: sessions.count == 1 ? "1 withdrawal" : "\(sessions.count) withdrawals",
                        subtitle: "Convert your USDC rewards to INR in your bank."
                    )

                    if sessions.isEmpty && !loading {
                        PpEmptyState(
                            title: "No withdrawals yet",
                            message: kycVerified
                                ? "Tap New withdrawal to send your first payout."
                                : "Verify your identity to start withdrawing."
                        )
                    } else {
                        VStack(spacing: 0) {
                            ForEach(Array(sessions.enumerated()), id: \.element.id) { i, s in
                                if i > 0 { PpDivider() }
                                OffRampRow(session: s)
                            }
                        }
                        .padding(.top, PpSpace.sm)
                    }
                }
            }
            .padding(.horizontal, PpSize.screenPadding)
            .padding(.bottom, PpSpace.xxl)
        }
        .background(PathPulseColor.background)
        .task { await refresh() }
        .refreshable { await refresh() }
        .sheet(isPresented: $kycSheetOpen) { KycView() }
        .sheet(isPresented: $withdrawSheetOpen, onDismiss: { Task { await refresh() } }) {
            WithdrawSheet(data: data, limits: limits)
        }
    }

    // MARK: - Header variants

    @ViewBuilder private var verifiedHeader: some View {
        PpCard {
            HStack(spacing: PpSpace.md) {
                ZStack {
                    Circle().fill(PathPulseColor.mint26).frame(width: 40, height: 40)
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(PathPulseColor.mint)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("You're verified")
                        .font(PathPulseFont.titleMedium)
                        .foregroundStyle(PathPulseColor.black)
                    Text("Withdraw USDC to your registered bank in INR.")
                        .font(PathPulseFont.bodySmall)
                        .foregroundStyle(PathPulseColor.black60)
                }
                Spacer()
                Button(action: { withdrawSheetOpen = true }) {
                    Text("New withdrawal")
                        .font(PathPulseFont.labelMedium)
                        .foregroundStyle(PathPulseColor.white)
                        .padding(.horizontal, PpSpace.md)
                        .padding(.vertical, PpSpace.sm)
                        .background(PathPulseColor.black)
                        .clipShape(Capsule())
                }
            }
        }
    }

    @ViewBuilder private var kycBanner: some View {
        PpCard {
            HStack(spacing: PpSpace.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Verify your identity")
                        .font(PathPulseFont.titleMedium)
                        .foregroundStyle(PathPulseColor.black)
                    Text("A quick one-time check before your first withdrawal.")
                        .font(PathPulseFont.bodySmall)
                        .foregroundStyle(PathPulseColor.black60)
                }
                Spacer()
                Button(action: { kycSheetOpen = true }) {
                    Text(resume?.kycStatus == "rejected" || resume?.kycStatus == "re_kyc"
                         ? "Retry"
                         : (resume?.kycStatus == "manual_review" ? "In review" : "Start"))
                        .font(PathPulseFont.labelMedium)
                        .foregroundStyle(PathPulseColor.white)
                        .padding(.horizontal, PpSpace.md)
                        .padding(.vertical, PpSpace.sm)
                        .background(PathPulseColor.black)
                        .clipShape(Capsule())
                }
                .disabled(resume?.kycStatus == "manual_review")
            }
        }
    }

    @ViewBuilder private func limitsChip(_ l: CarretLimits) -> some View {
        HStack(spacing: PpSpace.sm) {
            Text("₹\(Int(l.remaining.withdraw_inr).formatted()) available today")
                .font(PathPulseFont.labelSmall)
                .foregroundStyle(l.remaining.withdraw_inr > 0 ? PathPulseColor.mintInk : PathPulseColor.red700)
                .padding(.horizontal, PpSpace.md)
                .padding(.vertical, PpSpace.xs)
                .background(l.remaining.withdraw_inr > 0 ? PathPulseColor.mint26 : PathPulseColor.red100)
                .clipShape(Capsule())
            Text("of ₹\(Int(l.dailyCapInr).formatted()) daily limit")
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black40)
        }
    }

    // MARK: - Refresh

    @MainActor
    private func refresh() async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        do {
            async let s = data.offRampSessions(limit: 50)
            async let l = data.carretLimits()
            async let r = data.resumeCarretKyc()
            sessions = try await s.items
            // Both are best-effort — missing sub-account etc. leaves them hidden.
            limits = (try? await l)
            resume = (try? await r) ?? nil
        } catch {
            errorMessage = UserErrors.message(error)
        }
    }
}

// MARK: - Withdrawal sheet

private struct WithdrawSheet: View {
    let data: DataRepository
    let limits: CarretLimits?
    @Environment(\.dismiss) private var dismiss

    @State private var amount: String = ""
    @State private var quote: OffRampQuote? = nil
    @State private var quoting = false
    @State private var placing = false
    @State private var placedSession: OffRampSession? = nil
    @State private var error: String? = nil
    @State private var quoteTask: Task<Void, Never>? = nil
    @State private var pollTask: Task<Void, Never>? = nil

    var body: some View {
        NavigationStack {
            ZStack {
                PathPulseColor.background.ignoresSafeArea()
                if let s = placedSession {
                    success(s)
                } else {
                    form
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text(placedSession == nil ? "New withdrawal" : "Withdrawal placed")
                        .font(PathPulseFont.labelLarge)
                        .foregroundStyle(PathPulseColor.black)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button(action: { dismiss() }) {
                        Image(systemName: "xmark")
                            .foregroundStyle(PathPulseColor.black)
                    }
                }
            }
        }
    }

    // MARK: Form

    @ViewBuilder private var form: some View {
        VStack(spacing: 0) {
            if let error {
                HStack(alignment: .top, spacing: PpSpace.sm) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(PathPulseColor.red600)
                    Text(error)
                        .font(PathPulseFont.bodySmall)
                        .foregroundStyle(PathPulseColor.red700)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(PpSpace.md)
                .background(PathPulseColor.red100)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.horizontal, PpSize.screenPadding)
                .padding(.top, PpSpace.md)
            }

            ScrollView {
                VStack(spacing: PpSpace.lg) {
                    amountCard
                    if let q = quote { quotePreview(q) }
                    if quoting { quotingHint }
                    limitsHint
                }
                .padding(PpSize.screenPadding)
            }

            Divider().background(PathPulseColor.black05)
            Button(action: { Task { await place() } }) {
                HStack(spacing: PpSpace.sm) {
                    if placing { ProgressView().tint(PathPulseColor.white) }
                    Text(placing ? "Placing…" : "Confirm withdrawal")
                        .font(PathPulseFont.labelLarge)
                        .foregroundStyle(PathPulseColor.white)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(canPlace ? PathPulseColor.black : PathPulseColor.black50)
                .clipShape(Capsule())
            }
            .disabled(!canPlace)
            .padding(.horizontal, PpSize.screenPadding)
            .padding(.vertical, PpSpace.md)
        }
    }

    @ViewBuilder private var amountCard: some View {
        VStack(alignment: .leading, spacing: PpSpace.xs) {
            Text("Amount")
                .font(PathPulseFont.labelSmall)
                .foregroundStyle(PathPulseColor.black50)
            HStack(spacing: PpSpace.sm) {
                TextField("0", text: $amount)
                    .keyboardType(.decimalPad)
                    .font(PathPulseFont.displaySmall)
                    .foregroundStyle(PathPulseColor.black)
                    .onChange(of: amount) { _, new in
                        // Sanitize to at most one dot, 7 decimals.
                        amount = sanitize(new)
                        rescheduleQuote()
                    }
                Text("USDC")
                    .font(PathPulseFont.titleLarge)
                    .foregroundStyle(PathPulseColor.black40)
            }
            .padding(PpSpace.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PathPulseColor.surface)
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(PathPulseColor.black15, lineWidth: 1),
            )
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    @ViewBuilder private func quotePreview(_ q: OffRampQuote) -> some View {
        VStack(alignment: .leading, spacing: PpSpace.sm) {
            HStack(alignment: .firstTextBaseline) {
                Text("You receive")
                    .font(PathPulseFont.labelMedium)
                    .foregroundStyle(PathPulseColor.black60)
                Spacer()
                Text("₹\(q.fiatAmount)")
                    .font(PathPulseFont.displaySmall)
                    .foregroundStyle(PathPulseColor.black)
            }
            HStack {
                Text("Rate")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black50)
                Spacer()
                Text("₹\(q.rate) / \(q.asset)")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black70)
            }
            ForEach(q.fees) { f in
                HStack {
                    Text(f.label)
                        .font(PathPulseFont.bodySmall)
                        .foregroundStyle(PathPulseColor.black50)
                    Spacer()
                    Text("\(f.currency == "INR" ? "₹" : "")\(f.amount)")
                        .font(PathPulseFont.bodySmall)
                        .foregroundStyle(PathPulseColor.black70)
                }
            }
            HStack(spacing: PpSpace.xs) {
                Image(systemName: q.live ? "bolt.fill" : "clock.arrow.circlepath")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(q.live ? PathPulseColor.mint : PathPulseColor.black40)
                Text(q.live ? "Live quote from \(q.provider.capitalized) · valid 10 min" : "Indicative rate — final rate locked at confirm")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black50)
            }
            .padding(.top, PpSpace.xs)
            HStack(spacing: PpSpace.xs) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(PathPulseColor.black40)
                Text("Funds are blocked the moment you confirm — the payout hits your bank once Carret marks the order filled.")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black50)
            }
        }
        .padding(PpSpace.md)
        .background(PathPulseColor.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(PathPulseColor.black05, lineWidth: 1),
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    @ViewBuilder private var quotingHint: some View {
        HStack(spacing: PpSpace.sm) {
            ProgressView().tint(PathPulseColor.mint)
            Text("Fetching rate…")
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black50)
        }
    }

    @ViewBuilder private var limitsHint: some View {
        if let l = limits {
            Text("Daily limit: ₹\(Int(l.remaining.withdraw_inr).formatted()) remaining of ₹\(Int(l.dailyCapInr).formatted()).")
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black50)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Success

    @ViewBuilder private func success(_ s: OffRampSession) -> some View {
        let (heroBg, heroFg, heroIcon, title, subtitle) = statusStyling(for: s)
        VStack(spacing: PpSpace.xl) {
            Spacer(minLength: PpSpace.xxxl)
            ZStack {
                Circle().fill(heroBg).frame(width: 140, height: 140)
                Image(systemName: heroIcon)
                    .font(.system(size: 64, weight: .semibold))
                    .foregroundStyle(heroFg)
            }
            VStack(spacing: PpSpace.sm) {
                Text(title)
                    .font(PathPulseFont.headlineMedium)
                    .foregroundStyle(PathPulseColor.black)
                Text(subtitle)
                    .font(PathPulseFont.bodyMedium)
                    .foregroundStyle(PathPulseColor.black60)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, PpSize.screenPadding)
                HStack(spacing: PpSpace.xs) {
                    PpStatusPill(
                        text: s.status.replacingOccurrences(of: "_", with: " "),
                        color: Color.ppOffRampStatus(s.status),
                    )
                    Text("\(s.amount) \(s.asset.code)")
                        .font(PathPulseFont.labelMedium)
                        .foregroundStyle(PathPulseColor.black70)
                }
                .padding(.top, PpSpace.xs)
            }
            Spacer()
            Button(action: { dismiss() }) {
                Text("Done")
                    .font(PathPulseFont.labelLarge)
                    .foregroundStyle(PathPulseColor.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(PathPulseColor.black)
                    .clipShape(Capsule())
            }
            .padding(.horizontal, PpSize.screenPadding)
            .padding(.bottom, PpSpace.xl)
        }
        .onAppear { pollUntilTerminal(sessionId: s.id) }
        .onDisappear { pollTask?.cancel() }
    }

    /// Poll the backend every 3s until the session hits a terminal state.
    /// Mirrors Carret's `open → filled | partially_filled | cancelled |
    /// partially_cancelled` transitions so the driver watches the payout
    /// land in real time.
    private func pollUntilTerminal(sessionId: String) {
        pollTask?.cancel()
        pollTask = Task {
            let terminalCarret: Set<String> = ["filled", "partially_filled", "cancelled", "partially_cancelled"]
            let terminalOurs: Set<String>  = ["completed", "error", "refunded"]
            while !Task.isCancelled {
                do {
                    let fresh = try await data.offRampSession(id: sessionId)
                    await MainActor.run { placedSession = fresh }
                    if terminalCarret.contains(fresh.status.lowercased())
                        || terminalOurs.contains(fresh.status.lowercased()) { return }
                } catch { /* keep polling */ }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    /// Maps a Carret / backend status to the hero-icon, title, and subtitle
    /// copy shown on the success screen. Intermediate states show a mint
    /// spinner-style checkmark; terminal filled shows the full checkmark;
    /// cancelled variants show the warning glyph.
    private func statusStyling(for s: OffRampSession) -> (Color, Color, String, String, String) {
        switch s.status.lowercased() {
        case "filled", "completed":
            return (
                PathPulseColor.mint26, PathPulseColor.mint, "checkmark.circle.fill",
                "Payout in your bank",
                "\(s.amount) \(s.asset.code) → \(s.fiatCurrency) landed."
            )
        case "partially_filled":
            return (
                PathPulseColor.mint26, PathPulseColor.mint, "checkmark.circle.fill",
                "Partially filled",
                "Some of your \(s.asset.code) converted. The remainder is refunded."
            )
        case "cancelled", "partially_cancelled", "error":
            return (
                PathPulseColor.red100, PathPulseColor.red600, "exclamationmark.triangle.fill",
                "Withdrawal didn't complete",
                "Carret cancelled the order. Any blocked funds are released back to your account."
            )
        default:
            return (
                PathPulseColor.mint26, PathPulseColor.mint, "hourglass",
                "Withdrawal placed",
                "\(s.amount) \(s.asset.code) → \(s.fiatCurrency). Waiting for Carret to fill your order."
            )
        }
    }

    // MARK: - Actions

    private var canPlace: Bool {
        guard let n = Double(amount), n > 0 else { return false }
        return quote != nil && !placing && !quoting
    }

    private func rescheduleQuote() {
        quoteTask?.cancel()
        quote = nil
        let a = amount
        guard let n = Double(a), n > 0 else { quoting = false; return }
        quoting = true
        quoteTask = Task {
            try? await Task.sleep(nanoseconds: 350_000_000) // small debounce
            if Task.isCancelled { return }
            do {
                let q = try await data.offRampQuote(amount: a)
                await MainActor.run {
                    if a == amount {
                        self.quote = q
                        self.error = nil
                    }
                    self.quoting = false
                }
            } catch {
                await MainActor.run {
                    if a == amount { self.error = UserErrors.message(error); self.quote = nil }
                    self.quoting = false
                }
            }
        }
    }

    @MainActor private func place() async {
        guard canPlace else { return }
        placing = true; error = nil
        defer { placing = false }
        do {
            let s = try await data.createOffRampSession(amount: amount)
            placedSession = s
        } catch {
            self.error = UserErrors.message(error)
        }
    }

    private func sanitize(_ raw: String) -> String {
        var s = raw.filter { $0.isNumber || $0 == "." }
        if let firstDot = s.firstIndex(of: ".") {
            let after = s.index(after: firstDot)
            let head = String(s[..<after])
            let tail = String(s[after...]).filter { $0.isNumber }
            let capped = String(tail.prefix(7))
            s = head + capped
        }
        return s
    }
}

// MARK: - Row

private struct OffRampRow: View {
    let session: OffRampSession

    var body: some View {
        HStack(spacing: PpSpace.md) {
            Text("OR")
                .font(PathPulseFont.labelSmall)
                .foregroundStyle(PathPulseColor.teal700)
                .frame(width: 36, height: 36)
                .background(PathPulseColor.teal50)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: PpSpace.sm) {
                    Text(session.provider.capitalized)
                        .font(PathPulseFont.bodyMedium)
                        .foregroundStyle(PathPulseColor.black)
                    PpStatusPill(
                        text: session.status.replacingOccurrences(of: "_", with: " "),
                        color: Color.ppOffRampStatus(session.status)
                    )
                }
                Text("→ \(session.fiatCurrency)")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text("\(session.amount) \(session.asset.code)")
                    .font(PathPulseFont.bodyMedium)
                    .foregroundStyle(PathPulseColor.black)
                Text(String(session.createdAt.prefix(10)))
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black40)
            }
        }
        .padding(.vertical, PpSpace.md)
    }
}
