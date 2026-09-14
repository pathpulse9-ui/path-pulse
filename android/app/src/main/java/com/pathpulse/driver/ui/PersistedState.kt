package com.pathpulse.driver.ui

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/**
 * `remember { mutableStateOf(…) }` that round-trips through SharedPreferences
 * under `key`. Values survive process death, back-outs, and app restarts.
 * File-backed pickers (Aadhaar / selfie) intentionally stay transient — we
 * keep them out of prefs to avoid stale URIs whose grants have expired.
 *
 * Bucket is `pathpulse.kyc` — one bucket for the whole wizard so
 * `PersistedState.clear(ctx)` wipes the draft in a single call.
 */
private const val BUCKET = "pathpulse.kyc"

private fun prefs(ctx: Context): SharedPreferences =
    ctx.getSharedPreferences(BUCKET, Context.MODE_PRIVATE)

@Composable
fun rememberPersistedString(key: String, initial: String): MutableState<String> {
    val ctx = LocalContext.current
    val p = remember(ctx) { prefs(ctx) }
    val state = remember { mutableStateOf(p.getString(key, null) ?: initial) }
    DisposableEffect(state.value, key) {
        p.edit().putString(key, state.value).apply()
        onDispose { }
    }
    return state
}

@Composable
fun rememberPersistedInt(key: String, initial: Int): MutableState<Int> {
    val ctx = LocalContext.current
    val p = remember(ctx) { prefs(ctx) }
    val state = remember { mutableStateOf(p.getInt(key, initial)) }
    DisposableEffect(state.value, key) {
        p.edit().putInt(key, state.value).apply()
        onDispose { }
    }
    return state
}

/**
 * Nullable Long — stored as a Long with the sentinel `-1L` meaning null.
 * Used for date-of-birth millis (real DOBs are always positive).
 */
@Composable
fun rememberPersistedLong(key: String, initial: Long?): MutableState<Long?> {
    val ctx = LocalContext.current
    val p = remember(ctx) { prefs(ctx) }
    val state = remember {
        val stored = p.getLong(key, Long.MIN_VALUE)
        mutableStateOf(if (stored == Long.MIN_VALUE) initial else stored)
    }
    DisposableEffect(state.value, key) {
        val v = state.value
        p.edit().putLong(key, v ?: Long.MIN_VALUE).apply()
        onDispose { }
    }
    return state
}

object KycDraft {
    /** Wipes every persisted KYC field. Call after `.Verified` success and on Start over. */
    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }
}
