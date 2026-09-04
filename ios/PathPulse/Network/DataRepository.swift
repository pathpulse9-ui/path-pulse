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
}
