import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// Carret KYC — 6-section flow (PAT-79).
///
/// Mirrors `web/app/dashboard/kyc/page.tsx`:
///   1. Sub-account (create fresh OR reuse existing accountId)
///   2. Initiate KYC session
///   3. PAN (JSON — number + name + dob)
///   4. Aadhaar XML (file upload)
///   5. Selfie (image upload)
///   6. Status polling (every 3s until verified / rejected)
struct KycView: View {
    @Environment(\.dismiss) private var dismiss

    // Section state machine — each section holds an idle/busy/success/error tag + message.
    @State private var steps: [Step: StepStatus] = [
        .account: .idle, .initiate: .idle, .pan: .idle,
        .aadhaar: .idle, .selfie: .idle, .polling: .idle, .done: .idle,
    ]

    // Section 1 form inputs
    @State private var accountId = ""
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var dob = ""            // dd/mm/yyyy
    @State private var country = "IN"
    @State private var gender: Gender = .male
    @State private var occupation = "Business Owner"
    @State private var income = "₹5 Lakhs-₹10 Lakhs"

    // Section 2
    @State private var sessionId = ""

    // Section 3
    @State private var panNumber = ""
    @State private var panName = ""
    @State private var panDob = ""

    // Section 4 + 5 file picks
    @State private var aadhaarPickerShown = false
    @State private var pickedAadhaarURL: URL? = nil
    @State private var selfieItem: PhotosPickerItem? = nil
    @State private var pickedSelfieURL: URL? = nil

    // Section 6
    @State private var kycStatus: CarretKycStatus? = nil
    @State private var pollError: String? = nil
    @State private var pollingTask: Task<Void, Never>? = nil

    private let data = DataRepository()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: PpSpace.md) {
                    intro
                    accountCard
                    initiateCard
                    panCard
                    aadhaarCard
                    selfieCard
                    if (steps[.selfie]?.isSuccess ?? false) || kycStatus != nil {
                        statusCard
                    }
                }
                .padding(.horizontal, PpSize.screenPadding)
                .padding(.vertical, PpSpace.lg)
            }
            .background(PathPulseColor.background)
            .navigationTitle("Driver KYC")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { pollingTask?.cancel(); dismiss() }
                }
            }
        }
        .onDisappear { pollingTask?.cancel() }
    }

    // MARK: - Header

    @ViewBuilder
    private var intro: some View {
        VStack(alignment: .leading, spacing: PpSpace.xs) {
            Text("Verify your identity")
                .font(PathPulseFont.titleMedium)
                .foregroundStyle(PathPulseColor.black)
            Text("A quick check so you can withdraw to your bank. Have your PAN and Aadhaar handy.")
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black60)
        }
        .padding(.bottom, PpSpace.sm)
    }

    // MARK: - Section 1 · Sub-account

    @ViewBuilder
    private var accountCard: some View {
        section(num: 1, title: "Your details", step: .account) {
            Text("A few basics we need on file before we can start verification.")
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black50)
                .padding(.bottom, PpSpace.sm)

            VStack(spacing: PpSpace.sm) {
                HStack(spacing: PpSpace.sm) {
                    field("First name", text: $firstName)
                    field("Last name",  text: $lastName)
                }
                field("Email", text: $email, placeholder: "you+kyc@gmail.com", keyboard: .emailAddress)
                field("Phone (12 char, no +)", text: $phone, placeholder: "919XXXXXXXXX", keyboard: .phonePad)
                HStack(spacing: PpSpace.sm) {
                    field("DOB (dd/mm/yyyy)", text: $dob, placeholder: "18/04/2003")
                    field("Country (ISO-2)", text: $country)
                }
                Picker("Gender", selection: $gender) {
                    ForEach(Gender.allCases) { Text($0.rawValue.capitalized).tag($0) }
                }
                .pickerStyle(.segmented)
                pickerField("Occupation", selection: $occupation, options: OCCUPATIONS)
                pickerField("Annual income", selection: $income, options: INCOMES)
            }

            HStack {
                Button(action: { Task { await createSubAccount() } }) {
                    Text((steps[.account]?.isBusy ?? false) ? "Saving…" : "Save details")
                        .font(PathPulseFont.labelMedium)
                        .foregroundStyle(PathPulseColor.white)
                        .padding(.horizontal, PpSpace.md)
                        .padding(.vertical, PpSpace.sm)
                        .background(PathPulseColor.black)
                        .clipShape(Capsule())
                }
                .disabled((steps[.account]?.isBusy ?? false))
            }
            .padding(.top, PpSpace.md)
        }
    }

    // MARK: - Section 2 · Initiate

    @ViewBuilder
    private var initiateCard: some View {
        section(num: 2, title: "Start verification", step: .initiate) {
            Text("We'll ask for your PAN card, Aadhaar file, and a selfie next.")
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black50)
                .padding(.bottom, PpSpace.sm)
            Button(action: { Task { await initiate() } }) {
                Text((steps[.initiate]?.isBusy ?? false) ? "Starting…" : "Start verification")
                    .font(PathPulseFont.labelMedium)
                    .foregroundStyle(PathPulseColor.white)
                    .padding(.horizontal, PpSpace.md)
                    .padding(.vertical, PpSpace.sm)
                    .background(accountId.isEmpty ? PathPulseColor.black50 : PathPulseColor.black)
                    .clipShape(Capsule())
            }
            .disabled(accountId.isEmpty || (steps[.initiate]?.isBusy ?? false))
        }
    }

    // MARK: - Section 3 · PAN

    @ViewBuilder
    private var panCard: some View {
        section(num: 3, title: "PAN card", step: .pan) {
            Text("Enter these exactly as printed on your PAN card.")
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black50)
                .padding(.bottom, PpSpace.sm)
            VStack(spacing: PpSpace.sm) {
                field("PAN number (10 characters)", text: $panNumber, placeholder: "ABCDE1234F")
                    .textInputAutocapitalization(.characters)
                field("Name on card", text: $panName)
                field("Date of birth (dd/mm/yyyy)", text: $panDob, placeholder: "18/04/2003")
            }
            Button(action: { Task { await submitPan() } }) {
                Text((steps[.pan]?.isBusy ?? false) ? "Checking…" : "Submit PAN")
                    .font(PathPulseFont.labelMedium)
                    .foregroundStyle(PathPulseColor.white)
                    .padding(.horizontal, PpSpace.md)
                    .padding(.vertical, PpSpace.sm)
                    .background(sessionId.isEmpty ? PathPulseColor.black50 : PathPulseColor.black)
                    .clipShape(Capsule())
            }
            .disabled(sessionId.isEmpty || (steps[.pan]?.isBusy ?? false))
            .padding(.top, PpSpace.md)
        }
    }

    // MARK: - Section 4 · Aadhaar XML

    @ViewBuilder
    private var aadhaarCard: some View {
        section(num: 4, title: "Aadhaar file", step: .aadhaar) {
            Text("Open DigiLocker → Aadhaar → Share as XML. Upload the ZIP file you get here.")
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black50)
                .padding(.bottom, PpSpace.sm)

            Button(action: { aadhaarPickerShown = true }) {
                HStack {
                    Image(systemName: "doc.badge.plus")
                    Text(pickedAadhaarURL?.lastPathComponent ?? "Choose Aadhaar file")
                        .lineLimit(1)
                }
                .font(PathPulseFont.labelMedium)
                .foregroundStyle(PathPulseColor.black)
                .padding(.horizontal, PpSpace.md)
                .padding(.vertical, PpSpace.sm)
                .frame(maxWidth: .infinity)
                .background(PathPulseColor.black05)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .fileImporter(
                isPresented: $aadhaarPickerShown,
                allowedContentTypes: [UTType.xml, UTType.zip],
            ) { result in
                if case .success(let url) = result {
                    pickedAadhaarURL = url
                }
            }

            Button(action: { Task { await uploadAadhaar() } }) {
                Text((steps[.aadhaar]?.isBusy ?? false) ? "Uploading…" : "Upload Aadhaar")
                    .font(PathPulseFont.labelMedium)
                    .foregroundStyle(PathPulseColor.white)
                    .padding(.horizontal, PpSpace.md)
                    .padding(.vertical, PpSpace.sm)
                    .background(pickedAadhaarURL == nil || sessionId.isEmpty
                                ? PathPulseColor.black50 : PathPulseColor.black)
                    .clipShape(Capsule())
            }
            .disabled(pickedAadhaarURL == nil || sessionId.isEmpty || (steps[.aadhaar]?.isBusy ?? false))
            .padding(.top, PpSpace.md)
        }
    }

    // MARK: - Section 5 · Selfie

    @ViewBuilder
    private var selfieCard: some View {
        section(num: 5, title: "Selfie", step: .selfie) {
            Text("Take a clear, well-lit photo facing the camera. Plain background works best.")
                .font(PathPulseFont.bodySmall)
                .foregroundStyle(PathPulseColor.black50)
                .padding(.bottom, PpSpace.sm)

            PhotosPicker(selection: $selfieItem, matching: .images) {
                HStack {
                    Image(systemName: "camera")
                    Text(pickedSelfieURL?.lastPathComponent ?? "Choose selfie")
                        .lineLimit(1)
                }
                .font(PathPulseFont.labelMedium)
                .foregroundStyle(PathPulseColor.black)
                .padding(.horizontal, PpSpace.md)
                .padding(.vertical, PpSpace.sm)
                .frame(maxWidth: .infinity)
                .background(PathPulseColor.black05)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .onChange(of: selfieItem) { _, newItem in
                Task { pickedSelfieURL = await savePickedPhoto(newItem) }
            }

            Button(action: { Task { await uploadSelfie() } }) {
                Text((steps[.selfie]?.isBusy ?? false) ? "Uploading…" : "Upload selfie")
                    .font(PathPulseFont.labelMedium)
                    .foregroundStyle(PathPulseColor.white)
                    .padding(.horizontal, PpSpace.md)
                    .padding(.vertical, PpSpace.sm)
                    .background(pickedSelfieURL == nil || sessionId.isEmpty
                                ? PathPulseColor.black50 : PathPulseColor.black)
                    .clipShape(Capsule())
            }
            .disabled(pickedSelfieURL == nil || sessionId.isEmpty || (steps[.selfie]?.isBusy ?? false))
            .padding(.top, PpSpace.md)
        }
    }

    // MARK: - Section 6 · Status

    @ViewBuilder
    private var statusCard: some View {
        section(num: 6, title: "Verification status", step: .polling) {
            if let s = kycStatus {
                HStack {
                    Text("Status:")
                        .font(PathPulseFont.bodySmall)
                        .foregroundStyle(PathPulseColor.black50)
                    statusPill(friendlyStatus(s.kyc_status))
                }
                if s.kyc_status == "manual_review" {
                    Text("Our team is taking a closer look. This can take a few hours — we'll notify you when it's done.")
                        .font(PathPulseFont.bodySmall)
                        .foregroundStyle(PathPulseColor.black60)
                        .padding(.top, PpSpace.sm)
                }
                if s.kyc_status == "verified" {
                    Text("All set. You're ready to withdraw to your bank.")
                        .font(PathPulseFont.bodySmall)
                        .foregroundStyle(PathPulseColor.black60)
                        .padding(.top, PpSpace.sm)
                }
                if s.kyc_status == "rejected" {
                    Text("Something didn't match. Tap \"Start over\" and try again with clearer documents.")
                        .font(PathPulseFont.bodySmall)
                        .foregroundStyle(PathPulseColor.black60)
                        .padding(.top, PpSpace.sm)
                }
            } else {
                Text("Checking your verification…")
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.black50)
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
    }

    // MARK: - Action handlers

    @MainActor
    private func createSubAccount() async {
        setStep(.account, .busy, "Saving your details…")
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
            setStep(.account, .success, "Details saved.")
        } catch {
            setStep(.account, .error, UserErrors.message(error))
        }
    }

    @MainActor
    private func initiate() async {
        setStep(.initiate, .busy, "Getting things ready…")
        do {
            let r = try await data.initiateCarretKyc(accountId: accountId)
            sessionId = r.session.session_id
            setStep(.initiate, .success, "Ready — please submit the documents below.")
        } catch {
            setStep(.initiate, .error, UserErrors.message(error))
        }
    }

    @MainActor
    private func submitPan() async {
        setStep(.pan, .busy, "Checking your PAN…")
        do {
            _ = try await data.submitCarretKycDocument(
                kycSessionId: sessionId,
                document: CarretKycDocumentSubmission(
                    document_type: "pan",
                    document_number: panNumber.uppercased(),
                    name: panName, dob: panDob,
                ),
            )
            setStep(.pan, .success, "PAN accepted.")
        } catch {
            setStep(.pan, .error, UserErrors.message(error))
        }
    }

    @MainActor
    private func uploadAadhaar() async {
        guard let url = pickedAadhaarURL else { return }
        setStep(.aadhaar, .busy, "Uploading Aadhaar…")
        do {
            // Get security-scoped access to the picked file.
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            try await data.uploadCarretKycFile(
                kycSession: sessionId, docType: "aadhaar", fileType: "xml", fileURL: url,
            )
            setStep(.aadhaar, .success, "Aadhaar received.")
        } catch {
            setStep(.aadhaar, .error, UserErrors.message(error))
        }
    }

    @MainActor
    private func uploadSelfie() async {
        guard let url = pickedSelfieURL else { return }
        setStep(.selfie, .busy, "Uploading your photo…")
        do {
            try await data.uploadCarretKycFile(
                kycSession: sessionId, docType: "selfie", fileType: "image", fileURL: url,
            )
            setStep(.selfie, .success, "Photo received.")
            setStep(.polling, .busy, "Checking your verification…")
            startPolling()
        } catch {
            setStep(.selfie, .error, UserErrors.message(error))
        }
    }

    @MainActor
    private func cleanupAndRetry() async {
        do {
            try await data.cleanupCarretKyc(accountId: accountId)
            sessionId = ""; kycStatus = nil; pollingTask?.cancel()
            setStep(.initiate, .idle, nil); setStep(.pan, .idle, nil)
            setStep(.aadhaar, .idle, nil);  setStep(.selfie, .idle, nil)
            setStep(.polling, .idle, nil);  setStep(.done, .idle, nil)
        } catch {
            pollError = UserErrors.message(error)
        }
    }

    /// Maps Carret's raw statuses to something a driver will read.
    private func friendlyStatus(_ raw: String) -> String {
        switch raw {
        case "verified":      return "verified"
        case "pending":       return "in progress"
        case "manual_review": return "under review"
        case "rejected":      return "needs attention"
        default:              return raw
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
                        pollError = nil
                        switch s.kyc_status {
                        case "verified":
                            setStep(.polling, .success, "KYC verified ✔")
                            setStep(.done, .success, "All done — this sub-account is off-ramp ready.")
                            pollingTask?.cancel()
                        case "rejected":
                            setStep(.polling, .error, "Rejected. Use Cleanup and retry with corrected docs.")
                            pollingTask?.cancel()
                        case "manual_review":
                            setStep(.polling, .busy, "Flagged for manual review at Carret — waiting on their team.")
                        default: break
                        }
                    }
                } catch {
                    await MainActor.run { pollError = UserErrors.message(error) }
                }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    /// PhotosPickerItem → local file URL that our multipart uploader can read.
    private func savePickedPhoto(_ item: PhotosPickerItem?) async -> URL? {
        guard let item, let data = try? await item.loadTransferable(type: Data.self) else { return nil }
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("selfie-\(UUID().uuidString).jpg")
        try? data.write(to: tmp)
        return tmp
    }

    // MARK: - Section chrome

    @ViewBuilder
    private func section<Content: View>(
        num: Int, title: String, step: Step,
        @ViewBuilder _ content: @escaping () -> Content,
    ) -> some View {
        PpCard {
            HStack {
                Text("\(num).")
                    .font(PathPulseFont.titleMedium).foregroundStyle(PathPulseColor.black40)
                Text(title)
                    .font(PathPulseFont.titleMedium).foregroundStyle(PathPulseColor.black)
                Spacer()
                stepBadge(steps[step] ?? .idle)
            }
            if case let .busy(msg)    = steps[step]!, let msg { messageLine(msg, color: PathPulseColor.black60) }
            if case let .success(msg) = steps[step]!, let msg { messageLine(msg, color: PathPulseColor.black60) }
            if case let .error(msg)   = steps[step]!, let msg { messageLine(msg, color: PathPulseColor.red600) }
            content()
                .padding(.top, PpSpace.sm)
        }
    }

    @ViewBuilder
    private func messageLine(_ text: String, color: Color) -> some View {
        Text(text)
            .font(PathPulseFont.bodySmall)
            .foregroundStyle(color)
            .padding(.top, PpSpace.xs)
    }

    @ViewBuilder
    private func stepBadge(_ s: StepStatus) -> some View {
        switch s {
        case .idle: EmptyView()
        case .busy:    pill("Running…", bg: PathPulseColor.blue50,  fg: PathPulseColor.blue700)
        case .success: pill("Done",     bg: PathPulseColor.green100, fg: PathPulseColor.green700)
        case .error:   pill("Error",    bg: PathPulseColor.red100,   fg: PathPulseColor.red700)
        }
    }

    @ViewBuilder
    private func statusPill(_ label: String) -> some View {
        let (bg, fg): (Color, Color) = {
            switch label {
            case "verified":      return (PathPulseColor.green100, PathPulseColor.green700)
            case "rejected":      return (PathPulseColor.red100,   PathPulseColor.red700)
            case "manual_review": return (Color(hex: 0xFEF3C7),    Color(hex: 0xB45309))
            default:              return (PathPulseColor.blue50,   PathPulseColor.blue700)
            }
        }()
        pill(label, bg: bg, fg: fg)
    }

    @ViewBuilder
    private func pill(_ text: String, bg: Color, fg: Color) -> some View {
        Text(text)
            .font(PathPulseFont.labelSmall)
            .foregroundStyle(fg)
            .padding(.horizontal, PpSpace.sm)
            .padding(.vertical, PpSpace.xs)
            .background(bg)
            .clipShape(Capsule())
    }

    // MARK: - Field helpers

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

    // Non-inline helpers stateful methods can call.
    private func setStep(_ step: Step, _ tag: StepTag, _ msg: String?) {
        switch tag {
        case .idle:    steps[step] = .idle
        case .busy:    steps[step] = .busy(msg)
        case .success: steps[step] = .success(msg)
        case .error:   steps[step] = .error(msg)
        }
    }
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

private enum Step: Hashable {
    case account, initiate, pan, aadhaar, selfie, polling, done
}

private enum StepStatus {
    case idle
    case busy(String?)
    case success(String?)
    case error(String?)

    var isBusy: Bool    { if case .busy    = self { return true } else { return false } }
    var isSuccess: Bool { if case .success = self { return true } else { return false } }
    var isError: Bool   { if case .error   = self { return true } else { return false } }
}

private enum StepTag { case idle, busy, success, error }
