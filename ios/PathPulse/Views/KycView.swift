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

    @State private var page: WizardPage = .welcome
    @State private var submitting = false
    @State private var error: String? = nil

    // Account / session
    @State private var accountId = ""
    @State private var sessionId = ""

    // Step 1 — details
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var dobDate: Date? = nil
    @State private var email = ""
    @State private var phone = ""             // just the local digits, no country code
    @State private var dialCode: DialCode = .india
    @State private var country = "IN"
    @State private var gender: Gender = .male
    @State private var occupation = "Business Owner"
    @State private var income = "₹5 Lakhs-₹10 Lakhs"

    // PAN
    @State private var panNumber = ""
    @State private var panName = ""
    @State private var panDobDate: Date? = nil

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
    private static func formatDob(_ d: Date) -> String { dobFormatter.string(from: d) }

    // Aadhaar + selfie
    @State private var aadhaarPickerShown = false
    @State private var pickedAadhaarURL: URL? = nil
    @State private var selfieItem: PhotosPickerItem? = nil
    @State private var pickedSelfieURL: URL? = nil

    // Verification poll
    @State private var kycStatus: CarretKycStatus? = nil
    @State private var pollingTask: Task<Void, Never>? = nil

    private let data = DataRepository()

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
                bullet("PAN card")
                bullet("Aadhaar (from DigiLocker, or a photo)")
                bullet("A quick selfie")
            }
            .padding(.top, PpSpace.lg)
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
                selection: $dobDate,
                label: "Date of birth",
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
                    HStack {
                        Text("🇮🇳").font(.title2)
                        Text("India").font(PathPulseFont.bodyLarge).foregroundStyle(PathPulseColor.black)
                        Spacer()
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(PathPulseColor.mint)
                    }
                    .padding(PpSpace.md)
                    .frame(maxWidth: .infinity)
                    .background(PathPulseColor.surface)
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(PathPulseColor.mint, lineWidth: 1.5))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
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

    // MARK: - PAN

    @ViewBuilder
    private var panPage: some View {
        pageShell(
            icon: "creditcard.fill",
            title: "Enter your PAN card",
            subtitle: "Copy these exactly as printed on the card — name spelling and DOB must match India's tax records.",
        ) {
            VStack(spacing: PpSpace.md) {
                bigField("PAN number (10 characters)", text: $panNumber, placeholder: "ABCDE1234F")
                    .textInputAutocapitalization(.characters)
                bigField("Name on card", text: $panName, placeholder: "e.g. RAHUL KUMAR SHARMA")
                datePickerCard(selection: $panDobDate, label: "Date of birth")
            }
            .padding(.top, PpSpace.lg)
        }
    }

    // MARK: - Aadhaar

    @ViewBuilder
    private var aadhaarPage: some View {
        pageShell(
            icon: "doc.badge.arrow.up.fill",
            title: "Upload your Aadhaar",
            subtitle: "The DigiLocker XML verifies fastest, but a clear photo or PDF of your card also works.",
        ) {
            VStack(spacing: PpSpace.md) {
                Button(action: { aadhaarPickerShown = true }) {
                    dropZone(
                        icon: pickedAadhaarURL == nil ? "arrow.up.doc.fill" : "checkmark.circle.fill",
                        title: pickedAadhaarURL?.lastPathComponent ?? "Choose Aadhaar file",
                        subtitle: pickedAadhaarURL == nil ? "XML, ZIP, JPG, PNG, or PDF" : "Ready to upload",
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
                    text: "Pro tip: DigiLocker → Aadhaar → Share as XML → set a 4-digit code → download the ZIP. That's the fastest path to verified.",
                )
            }
            .padding(.top, PpSpace.lg)
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
            primaryAction: { pollingTask?.cancel(); dismiss() },
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
    private func datePickerCard(selection: Binding<Date?>, label: String) -> some View {
        // Reasonable KYC window: 100 years back → 18 years old today.
        let maxDate = Calendar.current.date(byAdding: .year, value: -18, to: Date()) ?? Date()
        let minDate = Calendar.current.date(byAdding: .year, value: -100, to: Date()) ?? Date()
        VStack(alignment: .leading, spacing: PpSpace.xs) {
            Text(label).font(PathPulseFont.labelSmall).foregroundStyle(PathPulseColor.black50)
            DatePicker(
                "",
                selection: Binding(
                    get: { selection.wrappedValue ?? maxDate },
                    set: { selection.wrappedValue = $0 },
                ),
                in: minDate...maxDate,
                displayedComponents: .date,
            )
            .datePickerStyle(.compact)
            .labelsHidden()
            .tint(PathPulseColor.mint)
            .padding(.horizontal, PpSpace.md)
            .frame(height: 56)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PathPulseColor.surface)
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(PathPulseColor.black15, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
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
        case .pan:      return panNumber.count >= 10 && !panName.isEmpty && panDobDate != nil
        case .aadhaar:  return pickedAadhaarURL != nil
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
            if await createSubAccount() {
                if await initiate() { page = .pan }
            }
        case .pan:
            if await submitPan() { page = .aadhaar }
        case .aadhaar:
            if await uploadAadhaar() { page = .selfie }
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
            accountId = String(acc.id)
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

    @MainActor private func submitPan() async -> Bool {
        do {
            _ = try await data.submitCarretKycDocument(
                kycSessionId: sessionId,
                document: CarretKycDocumentSubmission(
                    document_type: "pan",
                    document_number: panNumber.uppercased(),
                    name: panName, dob: panDob,
                ),
            )
            return true
        } catch { self.error = UserErrors.message(error); return false }
    }

    @MainActor private func uploadAadhaar() async -> Bool {
        guard let url = pickedAadhaarURL else { return false }
        do {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            try await data.uploadCarretKycFile(
                kycSession: sessionId, docType: "aadhaar",
                fileType: aadhaarFileType(for: url),
                fileURL: url,
            )
            return true
        } catch { self.error = UserErrors.message(error); return false }
    }

    @MainActor private func uploadSelfie() async -> Bool {
        guard let url = pickedSelfieURL else { return false }
        do {
            try await data.uploadCarretKycFile(
                kycSession: sessionId, docType: "selfie", fileType: "image", fileURL: url,
            )
            return true
        } catch { self.error = UserErrors.message(error); return false }
    }

    @MainActor private func cleanupAndRetry() async {
        do {
            try await data.cleanupCarretKyc(accountId: accountId)
            sessionId = ""; kycStatus = nil; pollingTask?.cancel()
            page = .name
            error = nil
        } catch { self.error = UserErrors.message(error) }
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
        case .aadhaar:  return "Aadhaar"
        case .selfie:   return "Selfie"
        case .checking: return "Verifying"
        case .verified, .rejected: return "Verification"
        }
    }

    var action: WizardAction? {
        switch self {
        case .welcome:  return WizardAction(label: "Get started",     busyLabel: "Get started")
        case .name, .contact, .bornWhen: return WizardAction(label: "Continue", busyLabel: "Continue")
        case .about:    return WizardAction(label: "Continue",        busyLabel: "Saving…")
        case .pan:      return WizardAction(label: "Verify PAN",      busyLabel: "Checking…")
        case .aadhaar:  return WizardAction(label: "Upload Aadhaar",  busyLabel: "Uploading…")
        case .selfie:   return WizardAction(label: "Upload photo",    busyLabel: "Uploading…")
        default:        return nil
        }
    }
}

private struct WizardAction {
    let label: String
    let busyLabel: String
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
