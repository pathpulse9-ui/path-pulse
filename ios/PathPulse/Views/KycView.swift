import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// Polished multi-step KYC wizard.
///
/// Every step is a full-screen focused card with a hero illustration, one big
/// question or action, and a sticky primary CTA at the bottom. Enumerated
/// pickers (gender / occupation / income / country) are card lists you tap,
/// not tiny segmented controls or dropdowns. File pickers are illustrated
/// drop zones. Progress bar is a slim mint line with "Step X of N" label.
struct KycView: View {
    @Environment(\.dismiss) private var dismiss

    // ── Persisted wizard state ─────────────────────────────────────
    // Everything the user has typed is mirrored to UserDefaults so that
    // dismissing the sheet, force-quitting the app, or a network failure
    // never loses their progress. Files (Aadhaar + selfie) are the only
    // things NOT persisted — they'd bloat storage and can be re-picked
    // in one tap. Cleared on `.verified` and on `Start over`.
    @AppStorage("kyc_page_raw") private var pageRaw: Int = 0
    @AppStorage("kyc_accountId") private var accountId: String = ""
    @AppStorage("kyc_sessionId") private var sessionId: String = ""
    @AppStorage("kyc_firstName") private var firstName: String = ""
    @AppStorage("kyc_lastName") private var lastName: String = ""
    @AppStorage("kyc_email") private var email: String = ""
    @AppStorage("kyc_phone") private var phone: String = ""
    @AppStorage("kyc_dialCode") private var dialCodeRaw: String = DialCode.india.rawValue
    @AppStorage("kyc_country") private var country: String = "IN"
    @AppStorage("kyc_gender") private var genderRaw: String = Gender.male.rawValue
    @AppStorage("kyc_occupation") private var occupation: String = "Business Owner"
    @AppStorage("kyc_income") private var income: String = "₹5 Lakhs-₹10 Lakhs"
    @AppStorage("kyc_dobIso") private var dobIso: String = ""       // YYYY-MM-DD
    // PAN — now photo-first per Carret guidance. The number/name/dob fields
    // stay in @AppStorage so a driver who dropped a previous build's typed
    // PAN doesn't lose it, but the wizard no longer collects them.
    @AppStorage("kyc_panNumber") private var panNumber: String = ""
    @AppStorage("kyc_panName") private var panName: String = ""
    @AppStorage("kyc_panDobIso") private var panDobIso: String = ""

    // Secondary ID card — driver picks one of Aadhaar / Voter ID / Passport /
    // Driving License. Aadhaar is XML/file, the others are number-based.
    @AppStorage("kyc_secondaryTypeRaw") private var secondaryTypeRaw: String = SecondaryDocType.aadhaar.rawValue
    @AppStorage("kyc_secondaryNumber") private var secondaryNumber: String = ""
    @AppStorage("kyc_secondaryName") private var secondaryName: String = ""
    @AppStorage("kyc_secondaryDobIso") private var secondaryDobIso: String = ""
    // Passport-only extras
    @AppStorage("kyc_secondarySurname") private var secondarySurname: String = ""
    @AppStorage("kyc_secondaryFileNumber") private var secondaryFileNumber: String = ""
    @AppStorage("kyc_secondaryDateOfIssueIso") private var secondaryDateOfIssueIso: String = ""

    // ── Non-persisted (transient / files / network) ────────────────
    @State private var submitting = false
    @State private var error: String? = nil
    @State private var showDobSheet = false
    @State private var showPanDobSheet = false
    @State private var showCountrySheet = false
    @State private var showDialCodeSheet = false

    // Enum-typed views over the persisted raw fields — set-clauses write
    // through to @AppStorage automatically.
    private var page: WizardPage {
        get { WizardPage(rawValue: pageRaw) ?? .welcome }
        nonmutating set { pageRaw = newValue.rawValue }
    }
    private var gender: Gender {
        get { Gender(rawValue: genderRaw) ?? .male }
        nonmutating set { genderRaw = newValue.rawValue }
    }
    private var dialCode: DialCode {
        get { DialCode(rawValue: dialCodeRaw) ?? .india }
        nonmutating set { dialCodeRaw = newValue.rawValue }
    }
    private var dobDate: Date? {
        get { Self.parseIso(dobIso) }
        nonmutating set { dobIso = newValue.map(Self.toIso) ?? "" }
    }
    private var panDobDate: Date? {
        get { Self.parseIso(panDobIso) }
        nonmutating set { panDobIso = newValue.map(Self.toIso) ?? "" }
    }
    private var secondaryType: SecondaryDocType {
        get { SecondaryDocType(rawValue: secondaryTypeRaw) ?? .aadhaar }
        nonmutating set { secondaryTypeRaw = newValue.rawValue }
    }
    private var secondaryDobDate: Date? {
        get { Self.parseIso(secondaryDobIso) }
        nonmutating set { secondaryDobIso = newValue.map(Self.toIso) ?? "" }
    }
    private var secondaryDateOfIssueDate: Date? {
        get { Self.parseIso(secondaryDateOfIssueIso) }
        nonmutating set { secondaryDateOfIssueIso = newValue.map(Self.toIso) ?? "" }
    }
    /// Backend expects dd/mm/yyyy strings.
    private var secondaryDob: String { secondaryDobDate.map(Self.formatDob) ?? "" }
    private var secondaryDateOfIssue: String { secondaryDateOfIssueDate.map(Self.formatDob) ?? "" }

    // Files — transient. Driver re-picks after any relaunch (URIs die anyway).
    @State private var panPickerShown = false
    @State private var pickedPanURL: URL? = nil        // PAN card photo (image)
    @State private var aadhaarPickerShown = false
    @State private var pickedAadhaarURL: URL? = nil    // Aadhaar XML/photo — only used when secondary=aadhaar
    @State private var selfieItem: PhotosPickerItem? = nil
    @State private var pickedSelfieURL: URL? = nil
    @State private var showSecondaryDobSheet = false
    @State private var showSecondaryIssueSheet = false
    @State private var showSecondaryTypeSheet = false

    // Verification poll
    @State private var kycStatus: CarretKycStatus? = nil
    @State private var pollingTask: Task<Void, Never>? = nil

    private let data = DataRepository()

    /// Backend expects dd/mm/yyyy on both PAN + sub-account.
    private var dob: String { dobDate.map(Self.formatDob) ?? "" }
    private var panDob: String { panDobDate.map(Self.formatDob) ?? "" }
    /// Carret's `/register/` expects a bare 10-digit local number (no `+`, no
    /// country code). The dial-code picker is UI-only — we only send `phone`.
    private var fullPhone: String { phone.filter { $0.isNumber } }

    private static let dobFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "dd/MM/yyyy"
        f.locale = Locale(identifier: "en_IN")
        return f
    }()
    private static let isoFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
    private static func formatDob(_ d: Date) -> String { dobFormatter.string(from: d) }
    private static func toIso(_ d: Date) -> String { isoFormatter.string(from: d) }
    private static func parseIso(_ s: String) -> Date? { s.isEmpty ? nil : isoFormatter.date(from: s) }

    /// Wipes the persisted draft. Called on verified success + "Start over".
    private func clearDraft() {
        pageRaw = 0
        accountId = ""; sessionId = ""
        firstName = ""; lastName = ""
        email = ""; phone = ""
        dialCodeRaw = DialCode.india.rawValue
        country = "IN"
        genderRaw = Gender.male.rawValue
        occupation = "Business Owner"
        income = "₹5 Lakhs-₹10 Lakhs"
        dobIso = ""; panDobIso = ""
        panNumber = ""; panName = ""
        pickedAadhaarURL = nil; pickedSelfieURL = nil
        kycStatus = nil
    }

    var body: some View {
        NavigationStack {
            ZStack {
                PathPulseColor.background.ignoresSafeArea()
                VStack(spacing: 0) {
                    if page != .verified && page != .rejected {
                        progressBar
                    }
                    if let error {
                        errorBanner(error)
                    }
                    // Content
                    ScrollView { pageBody.padding(.bottom, PpSpace.xxxl) }
                    // Bottom CTA
                    if let action = page.action {
                        ctaBar(action)
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(action: onLeft) {
                        Image(systemName: page == .welcome ? "xmark" : "chevron.left")
                            .foregroundStyle(PathPulseColor.black)
                    }
                }
                ToolbarItem(placement: .principal) {
                    Text(page.navTitle)
                        .font(PathPulseFont.labelLarge)
                        .foregroundStyle(PathPulseColor.black)
                }
            }
        }
        .onDisappear { pollingTask?.cancel() }
        .sheet(isPresented: $showCountrySheet) {
            CountryPickerSheet(selection: $country, isPresented: $showCountrySheet)
        }
        .task { await attemptResume() }
    }

    /// On wizard mount, ask the backend if we already have a KYC application
    /// on file for this session (or for this driver's email from an earlier
    /// install / browser). If yes: hydrate accountId, and route to the right
    /// step based on its status — verified/rejected go straight to the
    /// outcome page, everything else lets the wizard continue where it left
    /// off. Failures are silent; the driver just starts from scratch.
    @MainActor private func attemptResume() async {
        // Session cookie may be seeded lazily on first request; give it a
        // beat before we call. Cheap; no user-visible delay.
        let resumed = try? await data.resumeCarretKyc()

        // The wizard's page is persisted to @AppStorage. Terminal pages
        // (.checking / .verified / .rejected) survive an app relaunch even
        // when the backend has no mapping any more — a stale .checking
        // leaves the driver watching a spinner that will never turn.
        // If we can't back the terminal page with an authoritative status
        // from the backend, snap to .welcome so the wizard is usable again.
        let isTerminal = page == .checking || page == .verified || page == .rejected
        guard let resumed else {
            if isTerminal { page = .welcome; error = nil }
            return
        }

        if accountId.isEmpty { accountId = resumed.carretAccountId }
        if email.isEmpty, let e = resumed.email { email = e }
        switch resumed.kycStatus {
        case "verified":
            page = .verified
        case "rejected", "re_kyc":
            // Carret's post-cleanup / post-failure state — driver has to
            // restart the KYC session from scratch. Route to the Rejected
            // outcome so they see the Start over CTA rather than a stuck
            // spinner or a mid-flow page.
            page = .rejected
        case "manual_review":
            page = .checking
            startPolling()
        default:
            // pending — leave the wizard where the driver last was so they
            // pick up mid-flow. Exception: if the persisted page is
            // .checking, kick off polling so the spinner actually resolves.
            if page == .checking { startPolling() }
            else if isTerminal { page = .welcome }  // .verified/.rejected leftover
        }
    }

    // MARK: - Chrome

    @ViewBuilder
    private var progressBar: some View {
        let step = page.stepIndex
        if step >= 0 {
            let frac = Double(step + 1) / Double(WizardPage.stepCount)
            HStack(spacing: PpSpace.sm) {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(PathPulseColor.black05)
                        Capsule().fill(PathPulseColor.mint)
                            .frame(width: max(8, geo.size.width * frac))
                    }
                }
                .frame(height: 4)
                Text("Step \(step + 1) of \(WizardPage.stepCount)")
                    .font(PathPulseFont.labelSmall)
                    .foregroundStyle(PathPulseColor.black50)
            }
            .padding(.horizontal, PpSize.screenPadding)
            .padding(.top, PpSpace.sm)
            .padding(.bottom, PpSpace.md)
        }
    }

    @ViewBuilder
    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: PpSpace.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(PathPulseColor.red600)
            Text(message)
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.red700)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(PpSpace.md)
        .background(PathPulseColor.red100)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal, PpSize.screenPadding)
        .padding(.bottom, PpSpace.sm)
    }

    @ViewBuilder
    private func ctaBar(_ action: WizardAction) -> some View {
        VStack(spacing: PpSpace.sm) {
            Divider().background(PathPulseColor.black05)
            Button(action: { Task { await performAction() } }) {
                HStack(spacing: PpSpace.sm) {
                    if submitting { ProgressView().tint(PathPulseColor.white) }
                    Text(submitting ? action.busyLabel : action.label)
                        .font(PathPulseFont.labelLarge)
                        .foregroundStyle(PathPulseColor.white)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .background(actionEnabled && !submitting ? PathPulseColor.black : PathPulseColor.black50)
                .clipShape(Capsule())
            }
            .disabled(!actionEnabled || submitting)
            .padding(.horizontal, PpSize.screenPadding)
            .padding(.bottom, PpSpace.md)
        }
        .background(PathPulseColor.background)
    }

    private func onLeft() {
        error = nil
        if let prev = page.previous {
            page = prev
        } else {
            pollingTask?.cancel()
            dismiss()
        }
    }

    // MARK: - Page routing

    @ViewBuilder
    private var pageBody: some View {
        switch page {
        case .welcome:  welcomePage
        case .name:     namePage
        case .contact:  contactPage
        case .bornWhen: dobPage
        case .about:    aboutPage
        case .pan:      panPage
        case .aadhaar:  aadhaarPage
        case .selfie:   selfiePage
        case .checking: checkingPage
        case .verified: verifiedPage
        case .rejected: rejectedPage
        }
    }

    // MARK: - Welcome

    @ViewBuilder
    private var welcomePage: some View {
        pageShell(
            icon: "checkmark.shield.fill",
            title: "Let's verify your identity",
            subtitle: "A one-time check so you can withdraw to your bank. Takes about 3 minutes.",
        ) {
            VStack(spacing: PpSpace.md) {
                bullet("Your name & basic details")
                bullet("A photo of your PAN card")
                bullet("One more ID: Aadhaar, Voter ID, Passport, or DL")
                bullet("A quick selfie")
            }
            .padding(.top, PpSpace.lg)
            // If a previous attempt left anything behind (persisted account /
            // session id or any typed field), show a subtle escape hatch that
            // wipes the draft and lets the driver start clean.
            if !accountId.isEmpty || !firstName.isEmpty || !email.isEmpty || !dobIso.isEmpty {
                Button {
                    Task { await freshStart() }
                } label: {
                    Text("Start fresh — clear saved details")
                        .font(PathPulseFont.labelMedium)
                        .foregroundStyle(PathPulseColor.black60)
                        .underline()
                }
                .padding(.top, PpSpace.md)
            }
        }
    }

    // MARK: - Name

    @ViewBuilder
    private var namePage: some View {
        pageShell(
            icon: "person.text.rectangle.fill",
            title: "What's your name?",
            subtitle: "Enter your name exactly as it appears on your PAN card.",
        ) {
            VStack(spacing: PpSpace.md) {
                bigField("First name", text: $firstName)
                bigField("Last name",  text: $lastName)
            }
            .padding(.top, PpSpace.lg)
        }
    }

    // MARK: - Contact

    @ViewBuilder
    private var contactPage: some View {
        pageShell(
            icon: "envelope.fill",
            title: "How can we reach you?",
            subtitle: "We'll send transaction updates to your email and phone.",
        ) {
            VStack(spacing: PpSpace.md) {
                bigField("Email", text: $email, placeholder: "you@gmail.com", keyboard: .emailAddress)
                phoneField
            }
            .padding(.top, PpSpace.lg)
        }
    }

    @ViewBuilder
    private var phoneField: some View {
        VStack(alignment: .leading, spacing: PpSpace.xs) {
            Text("Phone")
                .font(PathPulseFont.labelSmall)
                .foregroundStyle(PathPulseColor.black50)
            HStack(spacing: PpSpace.sm) {
                Menu {
                    ForEach(DialCode.allCases) { dc in
                        Button {
                            dialCode = dc
                        } label: {
                            Text("\(dc.flag)  \(dc.name)  +\(dc.digits)")
                        }
                    }
                } label: {
                    HStack(spacing: PpSpace.xs) {
                        Text(dialCode.flag)
                        Text("+\(dialCode.digits)")
                            .font(PathPulseFont.bodyLarge)
                            .foregroundStyle(PathPulseColor.black)
                        Image(systemName: "chevron.down")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(PathPulseColor.black50)
                    }
                    .padding(.horizontal, PpSpace.md)
                    .frame(height: 56)
                    .background(PathPulseColor.surface)
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(PathPulseColor.black15, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                TextField("9XXXXXXXXX", text: $phone)
                    .keyboardType(.numberPad)
                    .font(PathPulseFont.bodyLarge)
                    .padding(.horizontal, PpSpace.md)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                    .background(PathPulseColor.surface)
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(PathPulseColor.black15, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .onChange(of: phone) { _, new in
                        // Strip non-digits so paste from a "+91 98..." string works.
                        let digits = new.filter { $0.isNumber }
                        if digits != new { phone = digits }
                    }
            }
        }
    }

    // MARK: - DOB

    @ViewBuilder
    private var dobPage: some View {
        pageShell(
            icon: "calendar",
            title: "Your date of birth",
            subtitle: "Pick the date exactly as it appears on your PAN card.",
        ) {
            datePickerCard(
                selection: Binding(get: { dobDate }, set: { dobDate = $0 }),
                label: "Date of birth",
                isPresented: $showDobSheet,
            )
            .padding(.top, PpSpace.lg)
        }
    }

    // MARK: - About (country + gender + occupation + income)

    @ViewBuilder
    private var aboutPage: some View {
        pageShell(
            icon: "person.crop.circle.fill",
            title: "Tell us about yourself",
            subtitle: "A few quick details required by the payments partner.",
        ) {
            VStack(spacing: PpSpace.lg) {
                labeledSection("Gender") {
                    HStack(spacing: PpSpace.sm) {
                        ForEach(Gender.allCases) { g in
                            genderChip(g)
                        }
                    }
                }
                labeledSection("Occupation") {
                    cardPicker(selection: $occupation, options: OCCUPATIONS)
                }
                labeledSection("Annual income") {
                    cardPicker(selection: $income, options: INCOMES)
                }
                labeledSection("Country") {
                    Button { showCountrySheet = true } label: {
                        let selected = Country.byIso[country]
                        HStack {
                            Text(selected?.flag ?? "🌐").font(.title2)
                            Text(selected?.name ?? country)
                                .font(PathPulseFont.bodyLarge)
                                .foregroundStyle(PathPulseColor.black)
                            Spacer()
                            Image(systemName: "chevron.down")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(PathPulseColor.black40)
                        }
                        .padding(PpSpace.md)
                        .frame(maxWidth: .infinity)
                        .background(PathPulseColor.surface)
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(PathPulseColor.black15, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, PpSpace.lg)
        }
    }

    @ViewBuilder
    private func genderChip(_ g: Gender) -> some View {
        let selected = gender == g
        Button(action: { gender = g }) {
            VStack(spacing: PpSpace.xs) {
                Image(systemName: g.icon)
                    .font(.title2)
                    .foregroundStyle(selected ? PathPulseColor.mintInk : PathPulseColor.black70)
                Text(g.rawValue.capitalized)
                    .font(PathPulseFont.labelMedium)
                    .foregroundStyle(selected ? PathPulseColor.mintInk : PathPulseColor.black)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 72)
            .background(selected ? PathPulseColor.mint26 : PathPulseColor.surface)
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(selected ? PathPulseColor.mint : PathPulseColor.black05, lineWidth: 1.5)
            )
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: - PAN — photo upload (per Carret guidance)

    @ViewBuilder
    private var panPage: some View {
        pageShell(
            icon: "creditcard.fill",
            title: "Upload your PAN card",
            subtitle: "Snap a clear photo of the front of your PAN card — Carret extracts the number, name, and DOB from the image.",
        ) {
            VStack(spacing: PpSpace.md) {
                Button(action: { panPickerShown = true }) {
                    dropZone(
                        icon: pickedPanURL == nil ? "camera.fill" : "checkmark.circle.fill",
                        title: pickedPanURL?.lastPathComponent ?? "Choose PAN photo",
                        subtitle: pickedPanURL == nil ? "JPG, PNG, or PDF — front of the card" : "Ready to upload",
                        selected: pickedPanURL != nil,
                    )
                }
                .fileImporter(
                    isPresented: $panPickerShown,
                    allowedContentTypes: [.image, .jpeg, .png, .pdf],
                ) { result in
                    if case .success(let url) = result { pickedPanURL = url }
                }
                infoTile(
                    icon: "info.circle.fill",
                    text: "Good light, all four corners visible, no glare on the name or number strip.",
                )
            }
            .padding(.top, PpSpace.lg)
        }
    }

    // MARK: - Secondary ID (Aadhaar / Voter ID / Passport / Driving License)

    @ViewBuilder
    private var aadhaarPage: some View {
        pageShell(
            icon: secondaryType.icon,
            title: "Add a second ID",
            subtitle: "Carret needs one more identity document alongside your PAN. Pick the one you have handy.",
        ) {
            VStack(spacing: PpSpace.md) {
                secondaryTypePicker
                if secondaryType.isNumberBased {
                    secondaryNumberFields
                } else {
                    secondaryFilePicker
                }
            }
            .padding(.top, PpSpace.lg)
        }
        .onAppear(perform: prefillSecondaryFromEarlier)
    }

    /// Carry the name + DOB the driver already typed on the Name / DOB steps
    /// forward into the Secondary-ID fields so they don't have to re-type
    /// identical info. Only fills when the target field is empty — a manual
    /// edit is never overwritten.
    private func prefillSecondaryFromEarlier() {
        if secondaryName.isEmpty {
            let full = [firstName, lastName]
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
            if !full.isEmpty { secondaryName = full }
        }
        if secondarySurname.isEmpty, !lastName.isEmpty {
            secondarySurname = lastName.trimmingCharacters(in: .whitespaces)
        }
        if secondaryDobDate == nil, let dob = dobDate {
            secondaryDobDate = dob
        }
    }

    @ViewBuilder
    private var secondaryTypePicker: some View {
        Button(action: { showSecondaryTypeSheet = true }) {
            HStack(spacing: PpSpace.md) {
                Image(systemName: secondaryType.icon)
                    .foregroundStyle(PathPulseColor.mint)
                    .frame(width: 24)
                Text(secondaryType.displayName)
                    .font(PathPulseFont.bodyLarge)
                    .foregroundStyle(PathPulseColor.black)
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PathPulseColor.black50)
            }
            .padding(.horizontal, PpSpace.md)
            .frame(height: 56)
            .frame(maxWidth: .infinity)
            .background(PathPulseColor.surface)
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(PathPulseColor.black15, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .confirmationDialog("Choose a secondary ID", isPresented: $showSecondaryTypeSheet, titleVisibility: .visible) {
            ForEach(SecondaryDocType.allCases) { t in
                Button(t.displayName) { secondaryType = t }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    @ViewBuilder
    private var secondaryFilePicker: some View {
        VStack(spacing: PpSpace.md) {
            Button(action: { aadhaarPickerShown = true }) {
                dropZone(
                    icon: pickedAadhaarURL == nil ? "arrow.up.doc.fill" : "checkmark.circle.fill",
                    title: pickedAadhaarURL?.lastPathComponent ?? "Choose Aadhaar file",
                    subtitle: pickedAadhaarURL == nil ? "XML from DigiLocker, or a JPG/PNG/PDF" : "Ready to upload",
                    selected: pickedAadhaarURL != nil,
                )
            }
            .fileImporter(
                isPresented: $aadhaarPickerShown,
                allowedContentTypes: [.xml, .zip, .image, .jpeg, .png, .pdf],
            ) { result in
                if case .success(let url) = result { pickedAadhaarURL = url }
            }
            infoTile(
                icon: "sparkles",
                text: "DigiLocker → Aadhaar → Share as XML → set a 4-digit code → download the ZIP. Fastest path to verified.",
            )
        }
    }

    @ViewBuilder
    private var secondaryNumberFields: some View {
        VStack(spacing: PpSpace.md) {
            bigField(numberFieldLabel, text: $secondaryNumber, placeholder: numberFieldPlaceholder)
                .textInputAutocapitalization(.characters)
            if secondaryType != .voter_id {
                bigField("Full name (as on document)", text: $secondaryName, placeholder: "e.g. RAHUL KUMAR SHARMA")
            } else {
                bigField("Full name (as on card)", text: $secondaryName, placeholder: "e.g. RAHUL KUMAR SHARMA")
            }
            if secondaryType == .passport {
                bigField("Surname (as printed on passport)", text: $secondarySurname, placeholder: "SHARMA")
                bigField("File number", text: $secondaryFileNumber, placeholder: "e.g. XXX0612316XXXX")
                datePickerCard(
                    selection: Binding(get: { secondaryDateOfIssueDate }, set: { secondaryDateOfIssueDate = $0 }),
                    label: "Date of issue",
                    isPresented: $showSecondaryIssueSheet,
                    kind: .dateOfIssue,
                )
                datePickerCard(
                    selection: Binding(get: { secondaryDobDate }, set: { secondaryDobDate = $0 }),
                    label: "Date of birth",
                    isPresented: $showSecondaryDobSheet,
                )
            } else if secondaryType == .driving_license {
                datePickerCard(
                    selection: Binding(get: { secondaryDobDate }, set: { secondaryDobDate = $0 }),
                    label: "Date of birth",
                    isPresented: $showSecondaryDobSheet,
                )
            }
            infoTile(
                icon: "info.circle.fill",
                text: "Enter your document number exactly as printed. Spaces and case matter for some.",
            )
        }
    }

    private var numberFieldLabel: String {
        switch secondaryType {
        case .voter_id:        return "Voter ID number (EPIC)"
        case .passport:        return "Passport number"
        case .driving_license: return "Driving licence number"
        case .aadhaar:         return "Aadhaar number" // unreachable — Aadhaar is file-based
        }
    }
    private var numberFieldPlaceholder: String {
        switch secondaryType {
        case .voter_id:        return "e.g. KA14201XXXXXX"
        case .passport:        return "e.g. Z1234567"
        case .driving_license: return "e.g. KA14 20211234567"
        case .aadhaar:         return ""
        }
    }

    // MARK: - Selfie

    @ViewBuilder
    private var selfiePage: some View {
        pageShell(
            icon: "camera.fill",
            title: "Take a selfie",
            subtitle: "Front-facing, well-lit, plain background. We'll match it against your Aadhaar photo.",
        ) {
            VStack(spacing: PpSpace.md) {
                PhotosPicker(selection: $selfieItem, matching: .images) {
                    dropZone(
                        icon: pickedSelfieURL == nil ? "person.crop.rectangle.fill" : "checkmark.circle.fill",
                        title: pickedSelfieURL?.lastPathComponent ?? "Choose a selfie",
                        subtitle: pickedSelfieURL == nil ? "From your camera roll" : "Ready to upload",
                        selected: pickedSelfieURL != nil,
                    )
                }
                .onChange(of: selfieItem) { _, item in
                    Task { pickedSelfieURL = await savePickedPhoto(item) }
                }
                infoTile(
                    icon: "lightbulb.fill",
                    text: "For best results: no mask, no sunglasses, face fully lit, blank wall behind you.",
                )
            }
            .padding(.top, PpSpace.lg)
        }
    }

    // MARK: - Checking

    @ViewBuilder
    private var checkingPage: some View {
        VStack(spacing: PpSpace.xl) {
            Spacer(minLength: PpSpace.xxxl)
            ZStack {
                Circle().fill(PathPulseColor.mint26).frame(width: 140, height: 140)
                ProgressView().scaleEffect(1.6).tint(PathPulseColor.mint)
            }
            VStack(spacing: PpSpace.sm) {
                Text("Verifying your identity")
                    .font(PathPulseFont.headlineMedium)
                    .foregroundStyle(PathPulseColor.black)
                Text("This usually takes a few seconds. We'll show the result here as soon as it's done.")
                    .font(PathPulseFont.bodyMedium)
                    .foregroundStyle(PathPulseColor.black60)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, PpSize.screenPadding)
            }
            if let s = kycStatus, s.kyc_status == "manual_review" {
                infoTile(icon: "person.2.fill", text: "Under manual review by our partner. This can take a few hours — we'll notify you when it's done.")
                    .padding(.horizontal, PpSize.screenPadding)
                    .padding(.top, PpSpace.md)
            }
            Spacer()
        }
    }

    @ViewBuilder
    private var verifiedPage: some View {
        outcomePage(
            iconBg: PathPulseColor.mint26,
            iconFg: PathPulseColor.mint,
            icon: "checkmark.circle.fill",
            title: "You're verified",
            subtitle: "All set. You can now withdraw your USDC rewards to your bank.",
            primary: "Start using PathPulse",
            primaryAction: {
                pollingTask?.cancel()
                clearDraft() // wizard finished — free up the persisted draft
                dismiss()
            },
        )
    }

    @ViewBuilder
    private var rejectedPage: some View {
        outcomePage(
            iconBg: PathPulseColor.red100,
            iconFg: PathPulseColor.red600,
            icon: "exclamationmark.triangle.fill",
            title: "We couldn't verify you",
            subtitle: "Something didn't match. Try again with clearer documents — usually a name spelling mismatch on PAN, or a low-quality Aadhaar upload.",
            primary: "Start over",
            primaryAction: { Task { await cleanupAndRetry() } },
        )
    }

    // MARK: - Reusable chunks

    @ViewBuilder
    private func pageShell<Content: View>(
        icon: String,
        title: String,
        subtitle: String,
        @ViewBuilder _ content: () -> Content,
    ) -> some View {
        VStack(spacing: PpSpace.md) {
            ZStack {
                Circle()
                    .fill(PathPulseColor.mint26)
                    .frame(width: 96, height: 96)
                Image(systemName: icon)
                    .font(.system(size: 42, weight: .semibold))
                    .foregroundStyle(PathPulseColor.mintInk)
            }
            .padding(.top, PpSpace.xl)
            Text(title)
                .font(PathPulseFont.headlineMedium)
                .pathPulseKerning(.headlineMedium)
                .foregroundStyle(PathPulseColor.black)
                .multilineTextAlignment(.center)
                .padding(.horizontal, PpSize.screenPadding)
            Text(subtitle)
                .font(PathPulseFont.bodyMedium)
                .foregroundStyle(PathPulseColor.black60)
                .multilineTextAlignment(.center)
                .padding(.horizontal, PpSize.screenPadding)
            content()
                .padding(.horizontal, PpSize.screenPadding)
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func outcomePage(
        iconBg: Color, iconFg: Color, icon: String,
        title: String, subtitle: String,
        primary: String, primaryAction: @escaping () -> Void,
    ) -> some View {
        VStack(spacing: PpSpace.xl) {
            Spacer(minLength: PpSpace.xxxl)
            ZStack {
                Circle().fill(iconBg).frame(width: 140, height: 140)
                Image(systemName: icon)
                    .font(.system(size: 64, weight: .semibold))
                    .foregroundStyle(iconFg)
            }
            VStack(spacing: PpSpace.sm) {
                Text(title)
                    .font(PathPulseFont.headlineMedium)
                    .foregroundStyle(PathPulseColor.black)
                    .multilineTextAlignment(.center)
                Text(subtitle)
                    .font(PathPulseFont.bodyMedium)
                    .foregroundStyle(PathPulseColor.black60)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, PpSize.screenPadding)
            }
            Spacer()
            Button(action: primaryAction) {
                Text(primary)
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
    }

    @ViewBuilder
    private func bullet(_ text: String) -> some View {
        HStack(alignment: .top, spacing: PpSpace.sm) {
            ZStack {
                Circle().fill(PathPulseColor.mint26).frame(width: 24, height: 24)
                Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(PathPulseColor.mintInk)
            }
            Text(text)
                .font(PathPulseFont.bodyMedium)
                .foregroundStyle(PathPulseColor.black70)
            Spacer()
        }
    }

    @ViewBuilder
    private func datePickerCard(
        selection: Binding<Date?>,
        label: String,
        isPresented: Binding<Bool>,
        kind: DatePickerKind = .dateOfBirth,
    ) -> some View {
        let (minDate, maxDate) = kind.range
        return VStack(alignment: .leading, spacing: PpSpace.xs) {
            Text(label).font(PathPulseFont.labelSmall).foregroundStyle(PathPulseColor.black50)
            Button {
                isPresented.wrappedValue = true
            } label: {
                HStack(spacing: PpSpace.md) {
                    Image(systemName: "calendar")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(PathPulseColor.mint)
                    Text(selection.wrappedValue.map(Self.formatDob) ?? "Pick a date")
                        .font(PathPulseFont.bodyLarge)
                        .foregroundStyle(selection.wrappedValue == nil ? PathPulseColor.black40 : PathPulseColor.black)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(PathPulseColor.black40)
                }
                .padding(.horizontal, PpSpace.md)
                .frame(height: 56)
                .frame(maxWidth: .infinity)
                .background(PathPulseColor.surface)
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(PathPulseColor.black15, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .sheet(isPresented: isPresented) {
            datePickerSheet(
                selection: selection,
                title: label,
                minDate: minDate,
                maxDate: maxDate,
                isPresented: isPresented,
            )
        }
    }

    @ViewBuilder
    private func datePickerSheet(
        selection: Binding<Date?>,
        title: String,
        minDate: Date,
        maxDate: Date,
        isPresented: Binding<Bool>,
    ) -> some View {
        VStack(spacing: 0) {
            HStack {
                Button("Cancel") { isPresented.wrappedValue = false }
                    .foregroundStyle(PathPulseColor.black60)
                Spacer()
                Text(title)
                    .font(PathPulseFont.labelLarge)
                    .foregroundStyle(PathPulseColor.black)
                Spacer()
                Button("Done") { isPresented.wrappedValue = false }
                    .font(PathPulseFont.labelLarge)
                    .foregroundStyle(PathPulseColor.mint)
            }
            .padding(PpSpace.lg)
            Divider()
            DatePicker(
                "",
                selection: Binding(
                    get: { selection.wrappedValue ?? maxDate },
                    set: { selection.wrappedValue = $0 },
                ),
                in: minDate...maxDate,
                displayedComponents: .date,
            )
            .datePickerStyle(.wheel)
            .labelsHidden()
            .tint(PathPulseColor.mint)
            .padding(.horizontal, PpSpace.lg)
            Spacer(minLength: 0)
        }
        .presentationDetents([.height(360), .medium])
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private func bigField(
        _ label: String, text: Binding<String>,
        placeholder: String = "",
        keyboard: UIKeyboardType = .default,
    ) -> some View {
        VStack(alignment: .leading, spacing: PpSpace.xs) {
            Text(label).font(PathPulseFont.labelSmall).foregroundStyle(PathPulseColor.black50)
            TextField(placeholder, text: text)
                .keyboardType(keyboard)
                .font(PathPulseFont.bodyLarge)
                .padding(.horizontal, PpSpace.md)
                .frame(height: 56)
                .background(PathPulseColor.surface)
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(PathPulseColor.black15, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    @ViewBuilder
    private func labeledSection<Content: View>(_ label: String, @ViewBuilder _ c: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: PpSpace.sm) {
            Text(label)
                .font(PathPulseFont.labelMedium)
                .foregroundStyle(PathPulseColor.black70)
            c()
        }
    }

    @ViewBuilder
    private func cardPicker(selection: Binding<String>, options: [String]) -> some View {
        VStack(spacing: PpSpace.xs) {
            ForEach(options, id: \.self) { opt in
                let selected = selection.wrappedValue == opt
                Button(action: { selection.wrappedValue = opt }) {
                    HStack {
                        Text(opt)
                            .font(PathPulseFont.bodyLarge)
                            .foregroundStyle(PathPulseColor.black)
                        Spacer()
                        if selected {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(PathPulseColor.mint)
                        } else {
                            Image(systemName: "circle")
                                .foregroundStyle(PathPulseColor.black15)
                        }
                    }
                    .padding(PpSpace.md)
                    .frame(maxWidth: .infinity)
                    .background(selected ? PathPulseColor.mint26 : PathPulseColor.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(selected ? PathPulseColor.mint : PathPulseColor.black05, lineWidth: 1.5),
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    nonisolated private func dropZone(icon: String, title: String, subtitle: String, selected: Bool) -> some View {
        HStack(spacing: PpSpace.md) {
            ZStack {
                Circle()
                    .fill(selected ? PathPulseColor.mint26 : PathPulseColor.black05)
                    .frame(width: 56, height: 56)
                Image(systemName: icon)
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(selected ? PathPulseColor.mint : PathPulseColor.black70)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(PathPulseFont.bodyLarge)
                    .foregroundStyle(PathPulseColor.black)
                    .lineLimit(1)
                Text(subtitle)
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black50)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(PathPulseColor.black40)
        }
        .padding(PpSpace.md)
        .frame(maxWidth: .infinity)
        .background(PathPulseColor.surface)
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(selected ? PathPulseColor.mint : PathPulseColor.black05, lineWidth: 1.5),
        )
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    @ViewBuilder
    private func infoTile(icon: String, text: String) -> some View {
        HStack(alignment: .top, spacing: PpSpace.sm) {
            Image(systemName: icon)
                .foregroundStyle(PathPulseColor.mint)
                .font(.system(size: 16, weight: .semibold))
            Text(text)
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black70)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(PpSpace.md)
        .background(PathPulseColor.mint26.opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: - Actions

    private var actionEnabled: Bool {
        switch page {
        case .welcome:  return true
        case .name:     return !firstName.isEmpty && !lastName.isEmpty
        case .contact:  return email.contains("@") && phone.count == 10
        case .bornWhen: return dobDate != nil
        case .about:    return true
        case .pan:      return pickedPanURL != nil
        case .aadhaar:
            switch secondaryType {
            case .aadhaar:         return pickedAadhaarURL != nil
            case .voter_id:        return !secondaryNumber.isEmpty && !secondaryName.isEmpty
            case .driving_license: return !secondaryNumber.isEmpty && !secondaryName.isEmpty && secondaryDobDate != nil
            case .passport:
                return !secondaryNumber.isEmpty && !secondaryName.isEmpty && !secondarySurname.isEmpty
                    && !secondaryFileNumber.isEmpty
                    && secondaryDobDate != nil && secondaryDateOfIssueDate != nil
            }
        case .selfie:   return pickedSelfieURL != nil
        default:        return false
        }
    }

    private func performAction() async {
        submitting = true
        error = nil
        defer { submitting = false }
        switch page {
        case .welcome:
            page = .name
        case .name:
            page = .contact
        case .contact:
            page = .bornWhen
        case .bornWhen:
            page = .about
            // Autofill PAN DOB with the same value the user entered.
            if panDobDate == nil { panDobDate = dobDate }
        case .about:
            // Resume-safe: skip create if we already provisioned a sub-account
            // (user pressed back after PAN error and returned here — no need
            // to re-register with Carret and hit the duplicate-email 422).
            let created = accountId.isEmpty ? await createSubAccount() : true
            if created {
                let initiated = sessionId.isEmpty ? await initiate() : true
                if initiated { page = .pan }
            }
        case .pan:
            if await uploadPan() { page = .aadhaar }
        case .aadhaar:
            if await submitSecondary() { page = .selfie }
        case .selfie:
            if await uploadSelfie() {
                page = .checking
                startPolling()
            }
        default:
            break
        }
    }

    // MARK: - Backend calls

    @MainActor private func createSubAccount() async -> Bool {
        do {
            let acc = try await data.createCarretSubAccount(CarretSubAccountInput(
                email: email,
                phone_number: fullPhone,
                first_name: firstName, last_name: lastName,
                dob: dob, country: country,
                gender: gender.rawValue,
                occupation: occupation,
                annual_income: income,
            ))
            accountId = acc.carretAccountId
            // If this call adopted a pre-existing Carret account (either same
            // session, or same email from an earlier install), and it was
            // already verified/rejected, jump straight to the outcome page —
            // no point walking PAN/Aadhaar/selfie again.
            if acc.existed {
                if acc.kycStatus == "verified" { page = .verified; return false }
                if acc.kycStatus == "rejected" { page = .rejected; return false }
            }
            return true
        } catch { self.error = UserErrors.message(error); return false }
    }

    @MainActor private func initiate() async -> Bool {
        do {
            let r = try await data.initiateCarretKyc(accountId: accountId)
            sessionId = r.session.session_id
            return true
        } catch { self.error = UserErrors.message(error); return false }
    }

    /// PAN is now photo-first per Carret guidance — Carret OCRs the number,
    /// name, and DOB off the image itself.
    @MainActor private func uploadPan() async -> Bool {
        guard let url = pickedPanURL else { return false }
        do {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            try await data.uploadCarretKycFile(
                kycSession: sessionId, docType: "pan",
                fileType: "image",
                fileURL: url,
            )
            return true
        } catch {
            if isAlreadyAddedError(error) { return true }
            self.error = UserErrors.message(error); return false
        }
    }

    /// Secondary ID — Aadhaar via file upload (XML/photo), everything else
    /// via number-based `/kyc/document/submit/` with per-type fields.
    @MainActor private func submitSecondary() async -> Bool {
        do {
            switch secondaryType {
            case .aadhaar:
                guard let url = pickedAadhaarURL else { return false }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                try await data.uploadCarretKycFile(
                    kycSession: sessionId, docType: "aadhaar",
                    fileType: aadhaarFileType(for: url),
                    fileURL: url,
                )
            case .voter_id:
                try await data.submitCarretKycDocument(
                    kycSessionId: sessionId,
                    document: CarretKycDocumentSubmission(
                        document_type: "voter_id",
                        document_number: secondaryNumber.uppercased(),
                        name: secondaryName,
                    ),
                )
            case .driving_license:
                try await data.submitCarretKycDocument(
                    kycSessionId: sessionId,
                    document: CarretKycDocumentSubmission(
                        document_type: "driving_license",
                        document_number: secondaryNumber.uppercased(),
                        name: secondaryName,
                        dob: secondaryDob,
                    ),
                )
            case .passport:
                try await data.submitCarretKycDocument(
                    kycSessionId: sessionId,
                    document: CarretKycDocumentSubmission(
                        document_type: "passport",
                        document_number: secondaryNumber.uppercased(),
                        name: secondaryName,
                        dob: secondaryDob,
                        surname_from_passport: secondarySurname,
                        file_number: secondaryFileNumber,
                        date_of_issue: secondaryDateOfIssue,
                    ),
                )
            }
            return true
        } catch {
            // Idempotent success: if this doc was already attached to the
            // session (previous submit succeeded server-side but the client
            // never advanced), treat as done and move on.
            if isAlreadyAddedError(error) { return true }
            self.error = UserErrors.message(error); return false
        }
    }

    @MainActor private func uploadSelfie() async -> Bool {
        guard let url = pickedSelfieURL else { return false }
        do {
            try await data.uploadCarretKycFile(
                kycSession: sessionId, docType: "selfie", fileType: "image", fileURL: url,
            )
            return true
        } catch {
            if isAlreadyAddedError(error) { return true }
            self.error = UserErrors.message(error); return false
        }
    }

    /// Detects Carret's idempotent-already-here messages so the wizard can
    /// treat them as success. Covers:
    ///   • "A pan document is already added for this KYC session"
    ///   • "A voter_id document is already added for this KYC session"
    ///   • …etc for aadhaar / passport / driving_license / selfie
    private func isAlreadyAddedError(_ error: Error) -> Bool {
        guard case APIError.http(_, let payload) = (error as? APIError) ?? .invalidResponse,
              let msg = payload?.message.lowercased() else { return false }
        return msg.contains("already added") || msg.contains("already exists in pending")
    }

    @MainActor private func cleanupAndRetry() async {
        do {
            try await data.cleanupCarretKyc(accountId: accountId)
            sessionId = ""; kycStatus = nil; pollingTask?.cancel()
            page = .name
            error = nil
        } catch { self.error = UserErrors.message(error) }
    }

    /// Welcome-page "Start fresh" — full hard reset on both sides so the next
    /// KYC attempt is genuinely a new user, not silently adopted back into
    /// the previous accountId keyed on the (unchanged) guest session cookie.
    /// The single `session/reset` call:
    ///   • runs Carret's /kyc/cleanup for the currently mapped accountId
    ///   • deletes the backend's carret_subaccounts mapping row
    /// After that, `clearDraft()` wipes @AppStorage. Any resume-on-mount
    /// or provision-subaccount call after this starts from a blank slate.
    @MainActor private func freshStart() async {
        _ = try? await data.resetCarretSession()
        pollingTask?.cancel()
        clearDraft()
        error = nil
    }

    private func startPolling() {
        pollingTask?.cancel()
        pollingTask = Task {
            while !Task.isCancelled {
                do {
                    let s = try await data.getCarretKycStatus(accountId: accountId)
                    await MainActor.run {
                        kycStatus = s
                        if s.kyc_status == "verified" {
                            page = .verified; pollingTask?.cancel()
                        } else if s.kyc_status == "rejected" {
                            page = .rejected; pollingTask?.cancel()
                        }
                    }
                } catch { /* keep polling */ }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    private func aadhaarFileType(for url: URL) -> String {
        let ext = url.pathExtension.lowercased()
        return (ext == "xml" || ext == "zip") ? "xml" : "image"
    }

    private func savePickedPhoto(_ item: PhotosPickerItem?) async -> URL? {
        guard let item, let data = try? await item.loadTransferable(type: Data.self) else { return nil }
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("selfie-\(UUID().uuidString).jpg")
        try? data.write(to: tmp)
        return tmp
    }
}

// MARK: - Wizard model

private enum WizardPage: Int, CaseIterable {
    case welcome, name, contact, bornWhen, about, pan, aadhaar, selfie
    case checking, verified, rejected

    /// Steps we count in the progress bar (welcome + outcome pages don't count).
    static var stepCount: Int { 8 }
    var stepIndex: Int {
        switch self {
        case .welcome:  return 0
        case .name:     return 1
        case .contact:  return 2
        case .bornWhen: return 3
        case .about:    return 4
        case .pan:      return 5
        case .aadhaar:  return 6
        case .selfie:   return 7
        default:        return -1
        }
    }

    var previous: WizardPage? {
        switch self {
        case .welcome:  return nil
        case .name:     return .welcome
        case .contact:  return .name
        case .bornWhen: return .contact
        case .about:    return .bornWhen
        case .pan:      return .about
        case .aadhaar:  return .pan
        case .selfie:   return .aadhaar
        case .checking, .verified, .rejected: return nil
        }
    }

    var navTitle: String {
        switch self {
        case .welcome:  return "Verification"
        case .name, .contact, .bornWhen, .about: return "About you"
        case .pan:      return "PAN card"
        case .aadhaar:  return "Secondary ID"
        case .selfie:   return "Selfie"
        case .checking: return "Verifying"
        case .verified, .rejected: return "Verification"
        }
    }

    var action: WizardAction? {
        switch self {
        case .welcome:  return WizardAction(label: "Get started",   busyLabel: "Get started")
        case .name, .contact, .bornWhen: return WizardAction(label: "Continue", busyLabel: "Continue")
        case .about:    return WizardAction(label: "Continue",      busyLabel: "Saving…")
        case .pan:      return WizardAction(label: "Upload PAN",    busyLabel: "Uploading…")
        case .aadhaar:  return WizardAction(label: "Submit ID",     busyLabel: "Submitting…")
        case .selfie:   return WizardAction(label: "Upload photo",  busyLabel: "Uploading…")
        default:        return nil
        }
    }
}

private struct WizardAction {
    let label: String
    let busyLabel: String
}

/// The two acceptable date windows the wizard's date picker uses.
///
/// `dateOfBirth` — 18 years old today back to 100 years, the standard
/// KYC-eligible birth range.
/// `dateOfIssue` — a document issue date; the last 30 years up to today.
enum DatePickerKind {
    case dateOfBirth
    case dateOfIssue

    /// (min, max) inclusive range the picker allows.
    var range: (Date, Date) {
        let cal = Calendar.current
        let today = Date()
        switch self {
        case .dateOfBirth:
            let max = cal.date(byAdding: .year, value: -18,  to: today) ?? today
            let min = cal.date(byAdding: .year, value: -100, to: today) ?? today
            return (min, max)
        case .dateOfIssue:
            let max = today
            let min = cal.date(byAdding: .year, value: -30, to: today) ?? today
            return (min, max)
        }
    }
}

/// The four secondary-ID options Carret accepts alongside PAN.
///
/// Aadhaar is the only file-based option (XML from DigiLocker or a photo);
/// the rest submit via `/kyc/document/submit/` with a document number and
/// per-type fields. At least one secondary must be submitted for KYC to
/// pass — that's a Carret hard requirement, not a UI choice.
enum SecondaryDocType: String, CaseIterable, Identifiable {
    case aadhaar, voter_id, passport, driving_license
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .aadhaar:         return "Aadhaar (XML from DigiLocker)"
        case .voter_id:        return "Voter ID"
        case .passport:        return "Passport"
        case .driving_license: return "Driving License"
        }
    }
    var icon: String {
        switch self {
        case .aadhaar:         return "doc.badge.arrow.up.fill"
        case .voter_id:        return "person.crop.rectangle.stack.fill"
        case .passport:        return "book.closed.fill"
        case .driving_license: return "car.fill"
        }
    }
    /// Backend document_type value (Carret enum name).
    var apiValue: String { rawValue }
    /// Does the driver enter a document number (true) or upload a file (false)?
    var isNumberBased: Bool { self != .aadhaar }
}

private enum Gender: String, CaseIterable, Identifiable {
    case male, female, other
    var id: String { rawValue }
    var icon: String {
        switch self {
        case .male:   return "figure.stand"
        case .female: return "figure.stand.dress"
        case .other:  return "person.fill.questionmark"
        }
    }
}

/// Common ISD dial codes for the KYC phone field. India first (most drivers).
/// Backend expects a bare 10–12 digit string with no `+`; we concat `digits + local`.
private enum DialCode: String, CaseIterable, Identifiable {
    case india, uae, usa, uk, singapore, canada, australia
    var id: String { rawValue }
    var digits: String {
        switch self {
        case .india:     return "91"
        case .uae:       return "971"
        case .usa:       return "1"
        case .uk:        return "44"
        case .singapore: return "65"
        case .canada:    return "1"
        case .australia: return "61"
        }
    }
    var flag: String {
        switch self {
        case .india:     return "🇮🇳"
        case .uae:       return "🇦🇪"
        case .usa:       return "🇺🇸"
        case .uk:        return "🇬🇧"
        case .singapore: return "🇸🇬"
        case .canada:    return "🇨🇦"
        case .australia: return "🇦🇺"
        }
    }
    var name: String {
        switch self {
        case .india:     return "India"
        case .uae:       return "UAE"
        case .usa:       return "USA"
        case .uk:        return "UK"
        case .singapore: return "Singapore"
        case .canada:    return "Canada"
        case .australia: return "Australia"
        }
    }
}

private let OCCUPATIONS = [
    "Private Job", "Goverment Job", "Business Owner", "Home Maker",
    "Freelancer", "Unemployed", "Student", "Professional",
]
private let INCOMES = [
    "< ₹5 Lakhs", "₹5 Lakhs-₹10 Lakhs", "₹10 Lakhs-₹25 Lakhs",
    "₹25 Lakhs-₹50 Lakhs", "₹50 Lakhs-1 Crore", ">₹1 Crore",
]

// MARK: - Country picker

/// ISO-3166-1 alpha-2 country with a rendered flag glyph.
///
/// The full 249-entry ISO-3166 list is generated at runtime from
/// `Locale.Region.isoRegions` so we don't hand-maintain a table.
struct Country: Identifiable, Hashable {
    let iso: String  // ISO-2, e.g. "IN"
    let name: String // Localised English name, e.g. "India"
    var id: String { iso }
    var flag: String {
        // Regional indicator symbols: 'A' → 🇦, etc.
        iso.uppercased().unicodeScalars
            .compactMap { Unicode.Scalar(127397 + Int($0.value)) }
            .reduce("") { $0 + String($1) }
    }

    static let all: [Country] = {
        let locale = Locale(identifier: "en_US_POSIX")
        return Locale.Region.isoRegions
            .filter { $0.identifier.count == 2 }
            .compactMap { region -> Country? in
                let name = locale.localizedString(forRegionCode: region.identifier) ?? region.identifier
                return Country(iso: region.identifier, name: name)
            }
            .sorted { $0.name < $1.name }
    }()

    static let byIso: [String: Country] = Dictionary(uniqueKeysWithValues: all.map { ($0.iso, $0) })
}

private struct CountryPickerSheet: View {
    @Binding var selection: String
    @Binding var isPresented: Bool
    @State private var query = ""

    private var results: [Country] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return q.isEmpty
            ? Country.all
            : Country.all.filter { $0.name.lowercased().contains(q) || $0.iso.lowercased().contains(q) }
    }

    var body: some View {
        NavigationStack {
            List(results) { country in
                Button {
                    selection = country.iso
                    isPresented = false
                } label: {
                    HStack(spacing: PpSpace.md) {
                        Text(country.flag).font(.title2)
                        Text(country.name)
                            .font(PathPulseFont.bodyLarge)
                            .foregroundStyle(PathPulseColor.black)
                        Spacer()
                        if selection == country.iso {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(PathPulseColor.mint)
                        }
                    }
                }
                .buttonStyle(.plain)
                .listRowBackground(PathPulseColor.surface)
            }
            .listStyle(.plain)
            .searchable(text: $query, prompt: "Search countries")
            .navigationTitle("Country")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { isPresented = false }
                }
            }
            .background(PathPulseColor.background)
        }
    }
}
