import Foundation

/// Read-side data fetches for the dashboard. Mirrors Android's `DataRepository`.
struct DataRepository: Sendable {
    let client: APIClient

    init(client: APIClient = .shared) { self.client = client }

    func health() async throws -> HealthResponse {
        try await client.get("health")
    }

    func settlementBatches(limit: Int = 50) async throws -> SettlementBatchPage {
        try await client.get("v1/settlement/batches", query: ["limit": String(limit)])
    }

    func offRampSessions(limit: Int = 50) async throws -> OffRampSessionPage {
        try await client.get("v1/offramp/sessions", query: ["limit": String(limit)])
    }

    // MARK: - SCOUT

    func scoutRoster() async throws -> ScoutRoster {
        try await client.get("v1/scout")
    }

    func scoutLookup(address: String) async throws -> ScoutTierLookup {
        try await client.get("v1/scout/\(address)")
    }

    // MARK: - Treasury + distribution

    func treasuryConfig() async throws -> TreasuryConfig {
        try await client.get("v1/treasury/config")
    }

    func distributionAccounts() async throws -> [DistributionAccount] {
        try await client.get("v1/accounts/distribution")
    }

    // PAT-80: per-driver Carret daily-limit chip on the Off-ramp tab.
    func carretLimits() async throws -> CarretLimits {
        try await client.get("v1/carret/limits")
    }

    // MARK: - Carret KYC (PAT-79)

    func createCarretSubAccount(_ input: CarretSubAccountInput) async throws -> CarretSubAccountResponse {
        try await client.post("v1/carret/subaccount", body: input)
    }

    func initiateCarretKyc(accountId: String) async throws -> CarretKycInitiateResponse {
        struct Body: Codable { let account_id: String }
        return try await client.post("v1/carret/kyc/initiate", body: Body(account_id: accountId))
    }

    func submitCarretKycDocument(
        kycSessionId: String,
        document: CarretKycDocumentSubmission,
    ) async throws -> Data {
        struct Body: Codable {
            let kyc_session_id: String
            let document: CarretKycDocumentSubmission
        }
        // POST returns Carret's raw JSON — we don't type it, callers only care about HTTP success
        _ = try await client.post(
            "v1/carret/kyc/document",
            body: Body(kyc_session_id: kycSessionId, document: document),
        ) as CarretKycStatus
        return Data()
    }

    func uploadCarretKycFile(
        kycSession: String,
        docType: String,               // "aadhaar" | "selfie" | ...
        fileType: String,              // "image" | "xml"
        fileURL: URL,
    ) async throws {
        try await client.uploadMultipart(
            "v1/carret/kyc/file",
            fields: ["kyc_session": kycSession, "doc_type": docType, "file_type": fileType],
            fileField: "doc_front",
            fileURL: fileURL,
        )
    }

    func getCarretKycStatus(accountId: String) async throws -> CarretKycStatus {
        try await client.get("v1/carret/kyc/status/\(accountId)")
    }

    func cleanupCarretKyc(accountId: String) async throws {
        struct Body: Codable { let account_id: String }
        _ = try await client.postDiscardingBody("v1/carret/kyc/cleanup", body: Body(account_id: accountId))
    }
}
