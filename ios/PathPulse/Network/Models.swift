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
