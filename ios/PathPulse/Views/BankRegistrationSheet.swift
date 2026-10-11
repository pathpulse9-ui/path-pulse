import SwiftUI

struct BankRegistrationSheet: View {
    let data: DataRepository
    let onRegistered: (CarretBank) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var accountNo = ""
    @State private var ifsc = ""
    @State private var holder = ""
    @State private var bankName = ""
    @State private var submitting = false
    @State private var error: String? = nil

    private var accountValid: Bool { accountNo.range(of: #"^\d{9,18}$"#, options: .regularExpression) != nil }
    private var ifscValid: Bool { ifsc.range(of: #"^[A-Z]{4}0[A-Z0-9]{6}$"#, options: .regularExpression) != nil }
    private var canSubmit: Bool {
        accountValid && ifscValid
            && !holder.trimmingCharacters(in: .whitespaces).isEmpty
            && !bankName.trimmingCharacters(in: .whitespaces).isEmpty
            && !submitting
    }

    var body: some View {
        NavigationStack {
            ZStack {
                PathPulseColor.background.ignoresSafeArea()
                VStack(spacing: 0) {
                    ScrollView {
                        VStack(alignment: .leading, spacing: PpSpace.lg) {
                            Text("INR from your withdrawals lands here. Carret verifies ownership with a ₹1 penny-drop — usually clears in under a minute.")
                                .font(PathPulseFont.bodySmall)
                                .foregroundStyle(PathPulseColor.black60)
                            if let error { PpErrorBanner(message: error) }
                            field(
                                label: "Account number",
                                placeholder: "e.g. 33611990000004",
                                text: $accountNo,
                                hint: !accountNo.isEmpty && !accountValid ? "9–18 digits" : nil,
                                numeric: true
                            )
                            .onChange(of: accountNo) { _, new in accountNo = new.filter(\.isNumber) }
                            field(
                                label: "IFSC",
                                placeholder: "e.g. HDFC0001234",
                                text: $ifsc,
                                hint: !ifsc.isEmpty && !ifscValid ? "11 characters, e.g. HDFC0001234" : nil,
                                characters: true
                            )
                            .onChange(of: ifsc) { _, new in ifsc = String(new.uppercased().prefix(11)) }
                            field(
                                label: "Account holder name (as in passbook)",
                                placeholder: "e.g. AADITYA SINGH",
                                text: $holder,
                                characters: true
                            )
                            field(label: "Bank name", placeholder: "e.g. HDFC Bank", text: $bankName)
                        }
                        .padding(PpSize.screenPadding)
                    }

                    Divider().background(PathPulseColor.black05)
                    Button(action: { Task { await submit() } }) {
                        HStack(spacing: PpSpace.sm) {
                            if submitting { ProgressView().tint(PathPulseColor.white) }
                            Text(submitting ? "Verifying…" : "Add bank")
                                .font(PathPulseFont.labelLarge)
                                .foregroundStyle(PathPulseColor.white)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 56)
                        .background(canSubmit ? PathPulseColor.black : PathPulseColor.black50)
                        .clipShape(Capsule())
                    }
                    .disabled(!canSubmit)
                    .padding(.horizontal, PpSize.screenPadding)
                    .padding(.vertical, PpSpace.md)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    Text("Add your bank")
                        .font(PathPulseFont.labelLarge)
                        .foregroundStyle(PathPulseColor.black)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button(action: { dismiss() }) {
                        Image(systemName: "xmark").foregroundStyle(PathPulseColor.black)
                    }
                }
            }
        }
    }

    @ViewBuilder private func field(
        label: String,
        placeholder: String,
        text: Binding<String>,
        hint: String? = nil,
        numeric: Bool = false,
        characters: Bool = false
    ) -> some View {
        VStack(alignment: .leading, spacing: PpSpace.xs) {
            Text(label)
                .font(PathPulseFont.labelSmall)
                .foregroundStyle(PathPulseColor.black50)
            TextField(placeholder, text: text)
                .keyboardType(numeric ? .numberPad : .default)
                .textInputAutocapitalization(characters ? .characters : .words)
                .autocorrectionDisabled()
                .font(PathPulseFont.bodyLarge)
                .foregroundStyle(PathPulseColor.black)
                .padding(PpSpace.md)
                .background(PathPulseColor.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(PathPulseColor.black15, lineWidth: 1)
                )
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            if let hint {
                Text(hint)
                    .font(PathPulseFont.bodySmall)
                    .foregroundStyle(PathPulseColor.red600)
            }
        }
    }

    @MainActor private func submit() async {
        guard canSubmit else { return }
        submitting = true; error = nil
        defer { submitting = false }
        do {
            let bank = try await data.registerCarretBank(RegisterCarretBankRequest(
                bank_account_no: accountNo,
                bank_ifsc: ifsc.uppercased(),
                bank_account_name: holder.trimmingCharacters(in: .whitespaces),
                bank_name: bankName.trimmingCharacters(in: .whitespaces)
            ))
            onRegistered(bank)
            dismiss()
        } catch {
            self.error = UserErrors.message(error)
        }
    }
}
