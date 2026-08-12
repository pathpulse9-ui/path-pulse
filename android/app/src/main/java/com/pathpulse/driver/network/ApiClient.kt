package com.pathpulse.driver.network

import com.pathpulse.driver.BuildConfig
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
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

class AuthRepository(private val client: HttpClient = ApiClient.http, private val baseUrl: String = ApiClient.baseUrl) {

    suspend fun me(): SessionUser? {
        val response = client.get("$baseUrl/v1/auth/me")
        return response.body<AuthMeResponse>().user
    }

    suspend fun verifyGoogleIdToken(idToken: String): GoogleVerifyResponse {
        val response = client.post("$baseUrl/v1/auth/google/verify") {
            contentType(ContentType.Application.Json)
            setBody(GoogleVerifyRequest(idToken))
        }
        if (!response.status.isSuccess()) {
            val error = response.body<ApiError>()
            throw ApiException(error)
        }
        return response.body()
    }

    suspend fun continueAsGuest(): GuestSessionResponse {
        val response = client.post("$baseUrl/v1/auth/guest")
        return response.body()
    }

    suspend fun logout() {
        client.post("$baseUrl/v1/auth/logout")
    }
}

class ApiException(val apiError: ApiError) : Exception(apiError.message)
