package com.pathpulse.driver.network

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import io.ktor.client.plugins.cookies.AcceptAllCookiesStorage
import io.ktor.client.plugins.cookies.CookiesStorage
import io.ktor.http.Cookie
import io.ktor.http.Url
import io.ktor.util.date.GMTDate
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private const val TAG = "PathPulseSession"
private const val SESSION_COOKIE = "pathpulse_session"
private const val KEY_ALIAS = "pathpulse_session_key"
private const val PREFS = "pathpulse_secure"
private const val PREF_COOKIE = "session_cookie"

@Serializable
private data class StoredCookie(
    val name: String,
    val value: String,
    val domain: String,
    val path: String,
    val expiresMillis: Long?,
    val secure: Boolean,
    val httpOnly: Boolean,
)

object SessionCookieStorage : CookiesStorage {
    private val delegate = AcceptAllCookiesStorage()
    private val mutex = Mutex()
    private var prefs: SharedPreferences? = null
    private var restored = false

    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    }

    override suspend fun get(requestUrl: Url): List<Cookie> {
        restoreOnce()
        return delegate.get(requestUrl)
    }

    override suspend fun addCookie(requestUrl: Url, cookie: Cookie) {
        restoreOnce()
        delegate.addCookie(requestUrl, cookie)
        if (cookie.name != SESSION_COOKIE) return
        val expired = cookie.maxAge == 0 ||
            cookie.value.isEmpty() ||
            (cookie.expires?.timestamp ?: Long.MAX_VALUE) <= System.currentTimeMillis()
        if (expired) clear() else persist(requestUrl, cookie)
    }

    override fun close() = delegate.close()

    private suspend fun restoreOnce() = mutex.withLock {
        if (restored) return@withLock
        restored = true
        val stored = read() ?: return@withLock
        if ((stored.expiresMillis ?: Long.MAX_VALUE) <= System.currentTimeMillis()) {
            clear()
            return@withLock
        }
        val url = Url("${if (stored.secure) "https" else "http"}://${stored.domain}${stored.path}")
        delegate.addCookie(
            url,
            Cookie(
                name = stored.name,
                value = stored.value,
                expires = stored.expiresMillis?.let { GMTDate(it) },
                domain = stored.domain,
                path = stored.path,
                secure = stored.secure,
                httpOnly = stored.httpOnly,
            ),
        )
    }

    private fun persist(requestUrl: Url, cookie: Cookie) {
        val p = prefs ?: return
        val expiresMillis = cookie.maxAge?.let { System.currentTimeMillis() + it * 1000L }
            ?: cookie.expires?.timestamp
        val stored = StoredCookie(
            name = cookie.name,
            value = cookie.value,
            domain = cookie.domain ?: requestUrl.host,
            path = cookie.path ?: "/",
            expiresMillis = expiresMillis,
            secure = cookie.secure,
            httpOnly = cookie.httpOnly,
        )
        runCatching { p.edit().putString(PREF_COOKIE, encrypt(Json.encodeToString(StoredCookie.serializer(), stored))).apply() }
            .onFailure { Log.w(TAG, "could not persist session", it) }
    }

    private fun read(): StoredCookie? {
        val blob = prefs?.getString(PREF_COOKIE, null) ?: return null
        return runCatching { Json.decodeFromString(StoredCookie.serializer(), decrypt(blob)) }
            .onFailure {
                Log.w(TAG, "discarding unreadable session", it)
                clear()
            }
            .getOrNull()
    }

    private fun clear() {
        prefs?.edit()?.remove(PREF_COOKIE)?.apply()
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(
                KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
        }.generateKey()
    }

    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val sealed = cipher.iv + cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(sealed, Base64.NO_WRAP)
    }

    private fun decrypt(blob: String): String {
        val sealed = Base64.decode(blob, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, 12))
        }
        return String(cipher.doFinal(sealed, 12, sealed.size - 12), Charsets.UTF_8)
    }
}
