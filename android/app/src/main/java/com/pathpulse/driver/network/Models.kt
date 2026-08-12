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
