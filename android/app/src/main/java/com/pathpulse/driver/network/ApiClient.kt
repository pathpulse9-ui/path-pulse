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
import io.ktor.client.request.post
import io.ktor.client.request.setBody
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
}

class ApiException(val apiError: ApiError) : Exception(apiError.message)
