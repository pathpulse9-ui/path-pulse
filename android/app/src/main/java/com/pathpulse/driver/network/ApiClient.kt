package com.pathpulse.driver.network

import com.pathpulse.driver.BuildConfig
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.forms.submitFormWithBinaryData
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import kotlinx.serialization.Serializable
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

object ApiClient {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    val http = HttpClient(OkHttp) {
        expectSuccess = false
        install(HttpCookies)
        install(ContentNegotiation) { json(json) }
        install(HttpTimeout) {
            requestTimeoutMillis = 15_000
            connectTimeoutMillis = 10_000
        }
    }

    val baseUrl = BuildConfig.API_BASE
}

private suspend fun HttpResponse.ensureSuccess(): HttpResponse {
    if (status.isSuccess()) return this
    val error = runCatching { body<ApiError>() }.getOrNull()
        ?: ApiError(error = "http_${status.value}", message = status.description)
    throw ApiException(error)
}

class AuthRepository(private val client: HttpClient = ApiClient.http, private val baseUrl: String = ApiClient.baseUrl) {

    suspend fun me(): SessionUser? =
        client.get("$baseUrl/v1/auth/me").ensureSuccess().body<AuthMeResponse>().user

    suspend fun verifyGoogleIdToken(idToken: String): GoogleVerifyResponse =
        client.post("$baseUrl/v1/auth/google/verify") {
            contentType(ContentType.Application.Json)
            setBody(GoogleVerifyRequest(idToken))
        }.ensureSuccess().body()

    suspend fun continueAsGuest(): GuestSessionResponse =
        client.post("$baseUrl/v1/auth/guest").ensureSuccess().body()

    suspend fun logout() {
        client.post("$baseUrl/v1/auth/logout")
    }
}

class DataRepository(private val client: HttpClient = ApiClient.http, private val baseUrl: String = ApiClient.baseUrl) {

    suspend fun health(): HealthResponse =
        client.get("$baseUrl/health").ensureSuccess().body()

    suspend fun settlementBatches(limit: Int = 50): SettlementBatchPage =
        client.get("$baseUrl/v1/settlement/batches") { parameter("limit", limit) }
            .ensureSuccess().body()

    suspend fun offRampSessions(limit: Int = 50): OffRampSessionPage =
        client.get("$baseUrl/v1/offramp/sessions") { parameter("limit", limit) }
            .ensureSuccess().body()

    suspend fun scoutRoster(): ScoutRoster =
        client.get("$baseUrl/v1/scout").ensureSuccess().body()

    suspend fun scoutLookup(address: String): ScoutTierLookup =
        client.get("$baseUrl/v1/scout/$address").ensureSuccess().body()

    suspend fun treasuryConfig(): TreasuryConfig =
        client.get("$baseUrl/v1/treasury/config").ensureSuccess().body()

    suspend fun distributionAccounts(): List<DistributionAccount> =
        client.get("$baseUrl/v1/accounts/distribution").ensureSuccess().body()

    // PAT-80: per-driver Carret daily-limit chip on the Off-ramp tab.
    suspend fun carretLimits(): CarretLimits =
        client.get("$baseUrl/v1/carret/limits").ensureSuccess().body()

    // ── Carret KYC (PAT-79) ────────────────────────────────────────────

    suspend fun createCarretSubAccount(input: CarretSubAccountInput): CarretSubAccountResponse =
        client.post("$baseUrl/v1/carret/subaccount") {
            contentType(ContentType.Application.Json)
            setBody(input)
        }.ensureSuccess().body()

    @Serializable
    private data class AccountIdBody(val account_id: String)

    @Serializable
    private data class SubmitDocBody(
        val kyc_session_id: String,
        val document: CarretKycDocumentSubmission,
    )

    suspend fun initiateCarretKyc(accountId: String): CarretKycInitiateResponse =
        client.post("$baseUrl/v1/carret/kyc/initiate") {
            contentType(ContentType.Application.Json)
            setBody(AccountIdBody(accountId))
        }.ensureSuccess().body()

    suspend fun submitCarretKycDocument(
        kycSessionId: String,
        document: CarretKycDocumentSubmission,
    ) {
        client.post("$baseUrl/v1/carret/kyc/document") {
            contentType(ContentType.Application.Json)
            setBody(SubmitDocBody(kycSessionId, document))
        }.ensureSuccess()
    }

    /**
     * Multipart file upload — Aadhaar XML or selfie image.
     * Reads the file into memory (mobile-safe, files are <10 MB).
     */
    suspend fun uploadCarretKycFile(
        kycSession: String,
        docType: String,      // "aadhaar" | "selfie" | ...
        fileType: String,     // "image" | "xml"
        filename: String,
        fileBytes: ByteArray,
        mimeType: String,
    ) {
        client.submitFormWithBinaryData(
            url = "$baseUrl/v1/carret/kyc/file",
            formData = io.ktor.client.request.forms.formData {
                append("kyc_session", kycSession)
                append("doc_type", docType)
                append("file_type", fileType)
                append(
                    "doc_front", fileBytes,
                    io.ktor.http.Headers.build {
                        append(io.ktor.http.HttpHeaders.ContentType, mimeType)
                        append(io.ktor.http.HttpHeaders.ContentDisposition, "filename=\"$filename\"")
                    },
                )
            },
        ).ensureSuccess()
    }

    suspend fun getCarretKycStatus(accountId: String): CarretKycStatus =
        client.get("$baseUrl/v1/carret/kyc/status/$accountId").ensureSuccess().body()

    suspend fun cleanupCarretKyc(accountId: String) {
        client.post("$baseUrl/v1/carret/kyc/cleanup") {
            contentType(ContentType.Application.Json)
            setBody(AccountIdBody(accountId))
        }.ensureSuccess()
    }
}

class ApiException(val apiError: ApiError) : Exception(apiError.message)
