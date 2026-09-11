import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// Multi-page KYC wizard. Shows ONE step at a time with Continue / Back so it
/// doesn't overwhelm the driver. Success on each step auto-advances to the
/// next; polling for verification happens on the last page.
struct KycView: View {
    @Environment(\.dismiss) private var dismiss

    // Wizard cursor + shared submission state.
    @State private var page: WizardPage = .details
    @State private var submitting = false
    @State private var error: String? = nil

    // Section 1 — details
    @State private var accountId = ""
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var dob = ""                    // dd/mm/yyyy
    @State private var country = "IN"
    @State private var gender: Gender = .male
    @State private var occupation = "Business Owner"
    @State private var income = "₹5 Lakhs-₹10 Lakhs"

    // Section 2 — session (auto-initiated on entering PAN page)
    @State private var sessionId = ""

    // Section 3 — PAN
    @State private var panNumber = ""
    @State private var panName = ""
    @State private var panDob = ""

    // Section 4 — Aadhaar
    @State private var aadhaarPickerShown = false
    @State private var pickedAadhaarURL: URL? = nil
    // Section 5 — selfie
    @State private var selfieItem: PhotosPickerItem? = nil
    @State private var pickedSelfieURL: URL? = nil

    // Section 6 — polling
    @State private var kycStatus: CarretKycStatus? = nil
    @State private var pollingTask: Task<Void, Never>? = nil

    private let data = DataRepository()

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                progressBar
                if let error {
                    Text(error)
                        .font(PathPulseFont.bodySmall)
                        .foregroundStyle(PathPulseColor.red600)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(PpSpace.md)
                        .background(PathPulseColor.red100)
                        .padding(.horizontal, PpSize.screenPadding)
                        .padding(.bottom, PpSpace.sm)
                }
                ScrollView { currentPage.padding(.bottom, PpSpace.xxl) }
                actionBar
            }
            .background(PathPulseColor.background)
            .navigationTitle(page.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(page == .details ? "Close" : "Back") {
                        if page == .details {
                            pollingTask?.cancel(); dismiss()
                        } else {
                            error = nil
                            page = page.previous
                        }
                    }
                }
            }
        }
        .onDisappear { pollingTask?.cancel() }
    }

    // MARK: - Progress bar

    @ViewBuilder
    private var progressBar: some View {
        let idx = Double(page.index) / Double(WizardPage.total - 1)
        VStack(spacing: PpSpace.xs) {
            HStack {
                Text("Step \(page.index + 1) of \(WizardPage.total)")
                    .font(PathPulseFont.labelSmall)
                    .foregroundStyle(PathPulseColor.black50)
                Spacer()
                Text(page.title)
                    .font(PathPulseFont.labelSmall)
                    .foregroundStyle(PathPulseColor.black70)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(PathPulseColor.black05)
                    Capsule().fill(PathPulseColor.mint)
                        .frame(width: max(4, geo.size.width * idx))
                }
            }
            .frame(height: 4)
        }
        .padding(.horizontal, PpSize.screenPadding)
        .padding(.top, PpSpace.md)
        .padding(.bottom, PpSpace.md)
    }

    // MARK: - Page bodies

    @ViewBuilder
    private var currentPage: some View {
        switch page {
        case .details:  detailsPage
        case .pan:      panPage
        case .aadhaar:  aadhaarPage
        case .selfie:   selfiePage
        case .status:   statusPage
        }
    }

    @ViewBuilder
    private var detailsPage: some View {
        VStack(alignment: .leading, spacing: PpSpace.md) {
            hint("A few basics we'll need on file before we can start verification.")
            HStack(spacing: PpSpace.sm) {
                field("First name", text: $firstName)
                field("Last name",  text: $lastName)
            }
            field("Email", text: $email, placeholder: "you@gmail.com", keyboard: .emailAddress)
            field("Phone (12 digits, no +)", text: $phone, placeholder: "919XXXXXXXXX", keyboard: .phonePad)
            HStack(spacing: PpSpace.sm) {
                field("Date of birth (dd/mm/yyyy)", text: $dob, placeholder: "18/04/2003")
                field("Country (ISO-2)", text: $country)
            }
            picker("Gender", selection: $gender, options: Gender.allCases, label: \.rawValue)
            pickerField("Occupation", selection: $occupation, options: OCCUPATIONS)
            pickerField("Annual income", selection: $income, options: INCOMES)
        }
        .padding(.horizontal, PpSize.screenPadding)
    }

    @ViewBuilder
    private var panPage: some View {
        VStack(alignment: .leading, spacing: PpSpace.md) {
            hint("Enter these exactly as printed on your PAN card. If anything doesn't match India's tax records, Carret will reject it — so double-check spelling and DOB.")
            field("PAN number (10 characters)", text: $panNumber, placeholder: "ABCDE1234F")
                .textInputAutocapitalization(.characters)
            field("Name on card", text: $panName, placeholder: "e.g. RAHUL KUMAR SHARMA")
            field("Date of birth (dd/mm/yyyy)", text: $panDob, placeholder: "18/04/2003")
        }
        .padding(.horizontal, PpSize.screenPadding)
    }

    @ViewBuilder
    private var aadhaarPage: some View {
        VStack(alignment: .leading, spacing: PpSpace.md) {
            hint("Upload your Aadhaar. Accepted formats: XML / ZIP from DigiLocker (most reliable), or a clear photo/PDF of your Aadhaar card.")
            Button(action: { aadhaarPickerShown = true }) {
                HStack {
                    Image(systemName: pickedAadhaarURL == nil ? "doc.badge.plus" : "checkmark.circle.fill")
                        .foregroundStyle(pickedAadhaarURL == nil ? PathPulseColor.black70 : PathPulseColor.mint)
                    Text(pickedAadhaarURL?.lastPathComponent ?? "Choose file (XML, ZIP, JPG, PNG, PDF)")
                        .font(PathPulseFont.labelMedium)
                        .foregroundStyle(PathPulseColor.black)
                        .lineLimit(1)
                    Spacer()
                }
                .padding(PpSpace.md)
                .frame(maxWidth: .infinity)
                .background(PathPulseColor.surface)
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(PathPulseColor.black15, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .fileImporter(
                isPresented: $aadhaarPickerShown,
                allowedContentTypes: [
                    .xml, .zip,
                    .image, .jpeg, .png,
                    .pdf,
                ],
            ) { result in
                if case .success(let url) = result { pickedAadhaarURL = url }
            }

            hint("Tip: get the XML from DigiLocker → Aadhaar → Share as XML for the fastest verification.")
        }
        .padding(.horizontal, PpSize.screenPadding)
    }

    @ViewBuilder
    private var selfiePage: some View {
        VStack(alignment: .leading, spacing: PpSpace.md) {
            hint("Take a clear, well-lit photo facing the camera. Plain background works best.")
            PhotosPicker(selection: $selfieItem, matching: .images) {
                HStack {
                    Image(systemName: pickedSelfieURL == nil ? "camera" : "checkmark.circle.fill")
                        .foregroundStyle(pickedSelfieURL == nil ? PathPulseColor.black70 : PathPulseColor.mint)
                    Text(pickedSelfieURL?.lastPathComponent ?? "Choose a selfie")
                        .font(PathPulseFont.labelMedium)
                        .foregroundStyle(PathPulseColor.black)
                        .lineLimit(1)
                    Spacer()
                }
                .padding(PpSpace.md)
                .frame(maxWidth: .infinity)
                .background(PathPulseColor.surface)
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(PathPulseColor.black15, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .onChange(of: selfieItem) { _, newItem in
                Task { pickedSelfieURL = await savePickedPhoto(newItem) }
            }
        }
        .padding(.horizontal, PpSize.screenPadding)
    }

    @ViewBuilder
    private var statusPage: some View {
        VStack(alignment: .leading, spacing: PpSpace.md) {
            hint("We're checking your documents with the payments partner. This usually takes a few seconds.")
            if let s = kycStatus {
                statusCard(s)
            } else {
                loadingRow("Checking your verification…")
            }
            Button(action: { Task { await cleanupAndRetry() } }) {
                Text("Start over")
                    .font(PathPulseFont.labelSmall)
                    .foregroundStyle(PathPulseColor.black)
                    .padding(.horizontal, PpSpace.md)
                    .padding(.vertical, PpSpace.xs)
                    .background(Capsule().stroke(PathPulseColor.black15, lineWidth: 1))
            }
            .padding(.top, PpSpace.md)
        }
        .padding(.horizontal, PpSize.screenPadding)
    }

    // MARK: - Action bar

    @ViewBuilder
    private var actionBar: some View {
        if let action = page.action {
            VStack(spacing: 0) {
                Divider().background(PathPulseColor.black05)
                Button(action: { Task { await performAction() } }) {
                    HStack(spacing: PpSpace.sm) {
                        if submitting {
                            ProgressView().tint(PathPulseColor.white)
                        }
                        Text(submitting ? action.busyLabel : action.label)
                            .font(PathPulseFont.labelLarge)
                            .foregroundStyle(PathPulseColor.white)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: PpSize.control)
                    .background(actionEnabled && !submitting ? PathPulseColor.black : PathPulseColor.black50)
                    .clipShape(Capsule())
                }
                .disabled(!actionEnabled || submitting)
                .padding(.horizontal, PpSize.screenPadding)
                .padding(.vertical, PpSpace.md)
                .background(PathPulseColor.background)
            }
        }
    }

    private var actionEnabled: Bool {
        switch page {
        case .details:
            return !firstName.isEmpty && !lastName.isEmpty && !email.isEmpty
                && !phone.isEmpty && !dob.isEmpty
        case .pan:      return !panNumber.isEmpty && !panName.isEmpty && !panDob.isEmpty
        case .aadhaar:  return pickedAadhaarURL != nil
        case .selfie:   return pickedSelfieURL != nil
        case .status:   return false
        }
    }

    private func performAction() async {
        submitting = true
        error = nil
        defer { submitting = false }
        switch page {
        case .details:
            if await createSubAccount() { page = .pan; _ = await initiate() }
        case .pan:
            if await submitPan() { page = .aadhaar }
        case .aadhaar:
            if await uploadAadhaar() { page = .selfie }
        case .selfie:
            if await uploadSelfie() { page = .status; startPolling() }
        case .status:
            break
        }
    }

    // MARK: - Backend calls

    @MainActor
    private func createSubAccount() async -> Bool {
        do {
            let acc = try await data.createCarretSubAccount(CarretSubAccountInput(
                email: email,
                phone_number: phone.replacingOccurrences(of: "+", with: ""),
                first_name: firstName, last_name: lastName,
                dob: dob, country: country,
                gender: gender.rawValue,
                occupation: occupation,
                annual_income: income,
            ))
            accountId = String(acc.id)
            return true
        } catch {
            self.error = UserErrors.message(error)
            return false
        }
    }

    @MainActor
    private func initiate() async -> Bool {
        do {
            let r = try await data.initiateCarretKyc(accountId: accountId)
            sessionId = r.session.session_id
            return true
        } catch {
            self.error = UserErrors.message(error)
            return false
        }
    }

    @MainActor
    private func submitPan() async -> Bool {
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
        } catch {
            self.error = UserErrors.message(error)
            return false
        }
    }

    @MainActor
    private func uploadAadhaar() async -> Bool {
        guard let url = pickedAadhaarURL else { return false }
        do {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            try await data.uploadCarretKycFile(
                kycSession: sessionId,
                docType: "aadhaar",
                fileType: aadhaarFileType(for: url),
                fileURL: url,
            )
            return true
        } catch {
            self.error = UserErrors.message(error)
            return false
        }
    }

    @MainActor
    private func uploadSelfie() async -> Bool {
        guard let url = pickedSelfieURL else { return false }
        do {
            try await data.uploadCarretKycFile(
                kycSession: sessionId, docType: "selfie", fileType: "image", fileURL: url,
            )
            return true
        } catch {
            self.error = UserErrors.message(error)
            return false
        }
    }

    @MainActor
    private func cleanupAndRetry() async {
        do {
            try await data.cleanupCarretKyc(accountId: accountId)
            sessionId = ""; kycStatus = nil; pollingTask?.cancel()
            page = .details
            error = nil
        } catch {
            self.error = UserErrors.message(error)
        }
    }

    private func startPolling() {
        pollingTask?.cancel()
        pollingTask = Task {
            while !Task.isCancelled {
                do {
                    let s = try await data.getCarretKycStatus(accountId: accountId)
                    await MainActor.run {
                        kycStatus = s
                        if s.kyc_status == "verified" || s.kyc_status == "rejected" {
                            pollingTask?.cancel()
                        }
                    }
                } catch { /* keep polling */ }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    /// Pick the right file_type flag for whatever the user chose.
    private func aadhaarFileType(for url: URL) -> String {
        let ext = url.pathExtension.lowercased()
        return (ext == "xml" || ext == "zip") ? "xml" : "image"
    }

    /// PhotosPickerItem → local file URL that the multipart uploader can read.
    private func savePickedPhoto(_ item: PhotosPickerItem?) async -> URL? {
        guard let item, let data = try? await item.loadTransferable(type: Data.self) else { return nil }
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("selfie-\(UUID().uuidString).jpg")
        try? data.write(to: tmp)
        return tmp
    }

    // MARK: - Small view builders

    @ViewBuilder
    private func statusCard(_ s: CarretKycStatus) -> some View {
        let label = friendlyStatus(s.kyc_status)
        let explainer: String? = {
            switch s.kyc_status {
            case "verified":      return "All set. You're ready to withdraw to your bank."
            case "manual_review": return "Our team is taking a closer look. This can take a few hours — we'll notify you once it's done."
            case "rejected":      return "Something didn't match. Tap Start over and try again with clearer documents."
            default:              return nil
            }
        }()
        VStack(alignment: .leading, spacing: PpSpace.md) {
            HStack {
                Text("Status")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black50)
                Spacer()
                statusPill(label)
            }
            if let explainer {
                Text(explainer)
                    .font(PathPulseFont.bodyMedium)
                    .foregroundStyle(PathPulseColor.black70)
            }
        }
        .padding(PpSpace.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PathPulseColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    @ViewBuilder
    private func statusPill(_ label: String) -> some View {
        let (bg, fg): (Color, Color) = {
            switch label {
            case "verified":     return (PathPulseColor.green100, PathPulseColor.green700)
            case "needs attention": return (PathPulseColor.red100, PathPulseColor.red700)
            case "under review": return (Color(hex: 0xFEF3C7), Color(hex: 0xB45309))
            default:             return (PathPulseColor.blue50, PathPulseColor.blue700)
            }
        }()
        Text(label)
            .font(PathPulseFont.labelSmall)
            .foregroundStyle(fg)
            .padding(.horizontal, PpSpace.sm)
            .padding(.vertical, PpSpace.xs)
            .background(bg)
            .clipShape(Capsule())
    }

    private func friendlyStatus(_ raw: String) -> String {
        switch raw {
        case "verified":      return "verified"
        case "pending":       return "in progress"
        case "manual_review": return "under review"
        case "rejected":      return "needs attention"
        default:              return raw
        }
    }

    @ViewBuilder
    private func loadingRow(_ text: String) -> some View {
        HStack(spacing: PpSpace.sm) {
            ProgressView()
            Text(text)
                .font(PathPulseFont.bodyMedium)
                .foregroundStyle(PathPulseColor.black70)
        }
    }

    @ViewBuilder
    private func hint(_ text: String) -> some View {
        Text(text)
            .font(PathPulseFont.bodyMedium)
            .foregroundStyle(PathPulseColor.black70)
    }

    @ViewBuilder
    private func field(
        _ label: String, text: Binding<String>,
        placeholder: String = "",
        keyboard: UIKeyboardType = .default,
    ) -> some View {
        VStack(alignment: .leading, spacing: PpSpace.xs) {
            Text(label).font(PathPulseFont.labelSmall).foregroundStyle(PathPulseColor.black50)
            TextField(placeholder, text: text)
                .keyboardType(keyboard)
                .textFieldStyle(.roundedBorder)
        }
    }

    @ViewBuilder
    private func picker<Value: Hashable & Identifiable>(
        _ label: String,
        selection: Binding<Value>,
        options: [Value],
        label labelKP: KeyPath<Value, String>,
    ) -> some View {
        VStack(alignment: .leading, spacing: PpSpace.xs) {
            Text(label).font(PathPulseFont.labelSmall).foregroundStyle(PathPulseColor.black50)
            Picker("", selection: selection) {
                ForEach(options) { v in
                    Text(v[keyPath: labelKP].capitalized).tag(v)
                }
            }
            .pickerStyle(.segmented)
        }
    }

    @ViewBuilder
    private func pickerField(_ label: String, selection: Binding<String>, options: [String]) -> some View {
        VStack(alignment: .leading, spacing: PpSpace.xs) {
            Text(label).font(PathPulseFont.labelSmall).foregroundStyle(PathPulseColor.black50)
            Picker("", selection: selection) {
                ForEach(options, id: \.self) { Text($0).tag($0) }
            }
            .pickerStyle(.menu)
            .padding(.horizontal, PpSpace.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PathPulseColor.black05)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }
}

// MARK: - Wizard model

private enum WizardPage: Int, CaseIterable, Identifiable {
    case details, pan, aadhaar, selfie, status
    var id: Int { rawValue }
    var index: Int { rawValue }
    static var total: Int { WizardPage.allCases.count }

    var previous: WizardPage {
        WizardPage(rawValue: max(0, rawValue - 1)) ?? .details
    }

    var title: String {
        switch self {
        case .details: return "Your details"
        case .pan:     return "PAN card"
        case .aadhaar: return "Aadhaar"
        case .selfie:  return "Selfie"
        case .status:  return "Verification"
        }
    }

    var action: WizardAction? {
        switch self {
        case .details: return WizardAction(label: "Continue",      busyLabel: "Saving…")
        case .pan:     return WizardAction(label: "Verify PAN",    busyLabel: "Checking…")
        case .aadhaar: return WizardAction(label: "Upload Aadhaar", busyLabel: "Uploading…")
        case .selfie:  return WizardAction(label: "Upload photo",  busyLabel: "Uploading…")
        case .status:  return nil
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
}

private let OCCUPATIONS = [
    "Private Job", "Goverment Job", "Business Owner", "Home Maker",
    "Freelancer", "Unemployed", "Student", "Professional",
]
private let INCOMES = [
    "< ₹5 Lakhs", "₹5 Lakhs-₹10 Lakhs", "₹10 Lakhs-₹25 Lakhs",
    "₹25 Lakhs-₹50 Lakhs", "₹50 Lakhs-1 Crore", ">₹1 Crore",
]
