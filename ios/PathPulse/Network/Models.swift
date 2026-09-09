import Foundation

/// Wire models — 1:1 mirror of Android's `network/Models.kt`. Field names use
/// camelCase to match the Kotlin data classes; the backend serializer already
/// emits camelCase, so no custom `CodingKeys` are needed.

struct SessionUser: Codable, Equatable, Hashable {
    let userId: String
    let method: String
    var email: String?
    var address: String?
}

struct AuthMeResponse: Codable {
    var user: SessionUser?
}

struct ManagedWallet: Codable, Equatable, Hashable {
    let userId: String
    let address: String
    let provisioned: Bool
    let network: String
}

struct GoogleVerifyRequest: Codable {
    let idToken: String
}

struct GoogleVerifyResponse: Codable {
    let userId: String
    let wallet: ManagedWallet
}

struct GuestSessionResponse: Codable {
    let userId: String
}

struct APIErrorPayload: Codable, Equatable {
    let error: String
    let message: String
    var requestId: String?
}

struct HealthResponse: Codable {
    let status: String
    let network: String
    let horizon: String
    let version: String
}

struct AssetRef: Codable, Equatable, Hashable {
    let code: String
    var issuer: String?
}

struct SettlementSplit: Codable, Equatable, Hashable {
    let authorities: String
    let driverRewards: String
    let treasury: String
}

struct SettlementDriverPayout: Codable, Equatable, Hashable, Identifiable {
    let userId: String
    let address: String
    let tier: Int
    let multiplier: Double
    let amount: String

    var id: String { userId }
}

struct SettlementBatch: Codable, Equatable, Hashable, Identifiable {
    let id: String
    let createdAt: String
    let network: String
    let grossAmount: String
    let asset: AssetRef
    let split: SettlementSplit
    var driverPayouts: [SettlementDriverPayout] = []
    let txHash: String
    var sourceAddress: String? = nil
    var authoritiesAddress: String? = nil
    var driverPoolAddress: String? = nil
    var treasuryAddress: String? = nil
    var horizonUrl: String? = nil
    var payoutBatchId: String? = nil
}

struct SettlementBatchPage: Codable {
    var items: [SettlementBatch] = []
    var nextCursor: String?
}

struct OffRampSession: Codable, Equatable, Hashable, Identifiable {
    let id: String
    let provider: String
    let status: String
    let amount: String
    let asset: AssetRef
    let fiatCurrency: String
    let createdAt: String
}

struct OffRampSessionPage: Codable {
    var items: [OffRampSession] = []
    var nextCursor: String?
}

// MARK: - SCOUT (reputation)

struct ScoutTierInfo: Codable, Equatable, Hashable, Identifiable {
    let tier: Int
    let code: String
    let multiplier: Double

    var id: Int { tier }
}

struct ScoutRoster: Codable {
    let issuer: String
    let network: String
    var tiers: [ScoutTierInfo] = []
}

struct ScoutTierLookup: Codable {
    var tier: Int?
    var code: String?
    var multiplier: Double?
}

// MARK: - Treasury

struct TreasurySigner: Codable, Equatable, Hashable, Identifiable {
    let publicKey: String
    let weight: Int

    var id: String { publicKey }
}

struct TreasuryThresholds: Codable, Equatable, Hashable {
    let low: Int
    let medium: Int
    let high: Int
}

struct TreasuryConfig: Codable {
    let publicKey: String
    var signers: [TreasurySigner] = []
    let thresholds: TreasuryThresholds
    let network: String
}

// MARK: - Distribution accounts

// MARK: - Carret KYC (PAT-79)

struct CarretSubAccountInput: Codable {
    let email: String
    let phone_number: String
    let first_name: String
    let last_name: String
    let dob: String                // dd/mm/yyyy
    let country: String            // ISO-3166-1 alpha-2
    let gender: String             // male / female / other
    let occupation: String
    let annual_income: String
    var is_email_verified: Bool = true
    var is_mobile_number_verified: Bool = true
    var is_politicaly_exposed_person: Bool = false
}

struct CarretSubAccountResponse: Codable {
    let id: Int
    let reference_id: String
    let kyc_status: String
    var aml_status: String?
}

struct CarretKycSession: Codable {
    let session_id: String
    let status: String             // pending / verified / rejected / manual_review
    var initiated_at: String?
}

struct CarretKycInitiateResponse: Codable {
    let success: Bool
    let message: String
    let session: CarretKycSession
}

struct CarretKycDocumentSubmission: Codable {
    let document_type: String      // pan / aadhaar / voter_id / passport / driving_license / selfie
    var document_number: String?
    var name: String?
    var dob: String?
}

struct CarretKycDocumentEntry: Codable, Hashable, Identifiable {
    let document_type: String
    var status: String?
    var document_number: String?

    var id: String { document_type }
}

struct CarretKycStatus: Codable {
    var kyc_session: String?
    let kyc_status: String
    var ovd_documents: [CarretKycDocumentEntry]?
}

// MARK: - Carret daily limits (PAT-80)

struct CarretLimitsRemaining: Codable, Equatable, Hashable {
    let deposit_inr: Double
    let withdraw_inr: Double
    let deposit_crypto: Double
    let withdraw_crypto: Double
}

struct CarretLimits: Codable, Equatable, Hashable {
    let carretAccountId: String
    let dailyCapInr: Double
    let remaining: CarretLimitsRemaining
}

struct DistributionAccount: Codable, Equatable, Hashable, Identifiable {
    let role: String        // "partner_revenue" | "driver_pool" | "treasury"
    let publicKey: String
    let multisig: Bool
    let network: String

    var id: String { role }

    var label: String {
        switch role {
        case "partner_revenue": return "Authorities (50%)"
        case "driver_pool":     return "Driver pool (30%)"
        case "treasury":        return "Treasury (20%)"
        default:                return role.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}
