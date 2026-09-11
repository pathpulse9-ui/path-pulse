package com.pathpulse.driver.network

import io.ktor.client.plugins.HttpRequestTimeoutException
import io.ktor.client.plugins.ResponseException
import io.ktor.http.HttpStatusCode
import java.io.IOException

/**
 * Translates raw exceptions into copy a driver will understand. Never
 * surfaces stack traces, URLs, HTTP status codes, or JSON snippets in the
 * final message — those still go to Logcat so we can debug via `adb logcat`.
 */
object UserErrors {
    fun message(e: Throwable): String {
        // API-level typed error (thrown by ensureSuccess in ApiClient).
        if (e is ApiException) return httpMessage(e)

        if (e is ResponseException) return httpMessage(e.response.status.value)

        // Network / transport
        if (e is HttpRequestTimeoutException) return "Please check your internet connection and try again."
        if (e is IOException) return "Please check your internet connection and try again."

        return "Something went wrong. Please try again."
    }

    private fun httpMessage(e: ApiException): String {
        val status = e.apiError.error.substringAfter("http_", "").toIntOrNull()
        val msg = e.apiError.message
        // Prefer the server's user-safe message when it looks safe.
        val safeMsg = firstUsableSentence(msg)
        if (status == null) return safeMsg ?: "Something went wrong. Please try again."
        return httpMessage(status, safeMsg)
    }

    private fun httpMessage(status: Int, safeMsg: String? = null): String = when (status) {
        401 -> "Please sign in again to continue."
        403 -> "Our payments partner is briefly unavailable. Please try again in a few minutes."
        404 -> "This step is no longer available. Please start over."
        409 -> "That was already submitted. Refresh and try again if you don't see it."
        422 -> safeMsg ?: "Some of the details couldn't be accepted. Please review and try again."
        429 -> "You've reached today's withdraw limit. Available again tomorrow."
        in 500..599 -> "Something's off on our side. Please try again in a moment."
        else -> "Something went wrong. Please try again."
    }

    private fun firstUsableSentence(raw: String?): String? {
        val trimmed = raw?.trim().orEmpty()
        if (trimmed.isEmpty()) return null
        if ("{" in trimmed) return null
        if ("://" in trimmed) return null
        if ("stack" in trimmed.lowercase()) return null
        if ("undefined" in trimmed.lowercase()) return null
        return if (trimmed.length > 140) trimmed.take(140) + "…" else trimmed
    }
}
