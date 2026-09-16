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

    /// Session-authed find-or-create. Backend either returns the existing
    /// Carret account bound to this session (or to this email, from a prior
    /// install/browser), or creates a fresh one. Idempotent — callers can
    /// invoke it every time the wizard's About step is submitted without
    /// worrying about duplicate-email 4xxs.
    func createCarretSubAccount(_ input: CarretSubAccountInput) async throws -> CarretProvisionResponse {
        try await client.post("v1/carret/provision-subaccount", body: input)
    }

    /// GET /v1/carret/resume — is there a KYC application already on file
    /// for this session (or for this driver's email from an earlier one)?
    /// Returns nil when nothing is saved yet (backend responds 204).
    func resumeCarretKyc() async throws -> CarretResumeResponse? {
        try await client.getOptional("v1/carret/resume")
    }

    func initiateCarretKyc(accountId: String) async throws -> CarretKycInitiateResponse {
        struct Body: Codable { let account_id: String }
        return try await client.post("v1/carret/kyc/initiate", body: Body(account_id: accountId))
    }

    /// POST /v1/carret/kyc/document. Backend proxies Carret's
    /// `{success, message, document:{…}}` — we only need to know it succeeded;
    /// the driver-facing UI shows Carret's message on error, nothing else.
    /// Older code decoded this into `CarretKycStatus`, which never matched the
    /// actual shape → every 200 threw a .decoding error and surfaced as
    /// "We couldn't read the reply." on the phone.
    func submitCarretKycDocument(
        kycSessionId: String,
        document: CarretKycDocumentSubmission,
    ) async throws {
        struct Body: Codable {
            let kyc_session_id: String
            let document: CarretKycDocumentSubmission
        }
        let _: CarretKycDocumentSubmitResponse = try await client.post(
            "v1/carret/kyc/document",
            body: Body(kyc_session_id: kycSessionId, document: document),
        )
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
