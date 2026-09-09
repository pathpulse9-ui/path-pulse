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
    val tier: Int,
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
    val sourceAddress: String? = null,
    val authoritiesAddress: String? = null,
    val driverPoolAddress: String? = null,
    val treasuryAddress: String? = null,
    val horizonUrl: String? = null,
    val payoutBatchId: String? = null,
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

// --- SCOUT reputation ------------------------------------------------------

@Serializable
data class ScoutTierInfo(
    val tier: Int,
    val code: String,
    val multiplier: Double,
)

@Serializable
data class ScoutRoster(
    val issuer: String,
    val network: String,
    val tiers: List<ScoutTierInfo> = emptyList(),
)

@Serializable
data class ScoutTierLookup(
    val tier: Int? = null,
    val code: String? = null,
    val multiplier: Double? = null,
)

// --- Treasury + distribution ----------------------------------------------

@Serializable
data class TreasurySigner(
    val publicKey: String,
    val weight: Int,
)

@Serializable
data class TreasuryThresholds(
    val low: Int,
    val medium: Int,
    val high: Int,
)

@Serializable
data class TreasuryConfig(
    val publicKey: String,
    val signers: List<TreasurySigner> = emptyList(),
    val thresholds: TreasuryThresholds,
    val network: String,
)

// PAT-80: Carret daily-limit tracking
@Serializable
data class CarretLimitsRemaining(
    val deposit_inr: Double,
    val withdraw_inr: Double,
    val deposit_crypto: Double,
    val withdraw_crypto: Double,
)

@Serializable
data class CarretLimits(
    val carretAccountId: String,
    val dailyCapInr: Double,
    val remaining: CarretLimitsRemaining,
)

@Serializable
data class DistributionAccount(
    val role: String,
    val publicKey: String,
    val multisig: Boolean,
    val network: String,
)
