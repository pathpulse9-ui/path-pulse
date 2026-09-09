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
}
