package com.pathpulse.driver.network

import kotlinx.serialization.Serializable

@Serializable
data class SessionUser(
    val userId: String,
    val method: String,
    val email: String? = null,
    val address: String? = null,
)

@Serializable
data class AuthMeResponse(
    val user: SessionUser? = null,
)

@Serializable
data class ManagedWallet(
    val userId: String,
    val address: String,
    val provisioned: Boolean,
    val network: String,
)

@Serializable
data class GoogleVerifyRequest(
    val idToken: String,
)

@Serializable
data class GoogleVerifyResponse(
    val userId: String,
    val wallet: ManagedWallet,
)

@Serializable
data class GuestSessionResponse(
    val userId: String,
)

@Serializable
data class ApiError(
    val error: String,
    val message: String,
    val requestId: String? = null,
)

@Serializable
data class HealthResponse(
    val status: String,
    val network: String,
    val horizon: String,
    val version: String,
)

@Serializable
data class AssetRef(
    val code: String,
    val issuer: String? = null,
)

@Serializable
data class SettlementSplit(
    val authorities: String,
    val driverRewards: String,
    val treasury: String,
)

@Serializable
data class SettlementDriverPayout(
    val userId: String,
    val address: String,
    val tier: String,
    val multiplier: Double,
    val amount: String,
)

@Serializable
data class SettlementBatch(
    val id: String,
    val createdAt: String,
    val network: String,
    val grossAmount: String,
    val asset: AssetRef,
    val split: SettlementSplit,
    val driverPayouts: List<SettlementDriverPayout> = emptyList(),
    val txHash: String,
)

@Serializable
data class SettlementBatchPage(
    val items: List<SettlementBatch> = emptyList(),
    val nextCursor: String? = null,
)

@Serializable
data class OffRampSession(
    val id: String,
    val provider: String,
    val status: String,
    val amount: String,
    val asset: AssetRef,
    val fiatCurrency: String,
    val createdAt: String,
)

@Serializable
data class OffRampSessionPage(
    val items: List<OffRampSession> = emptyList(),
    val nextCursor: String? = null,
)
