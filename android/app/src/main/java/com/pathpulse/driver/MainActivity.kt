package com.pathpulse.driver

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.credentials.CredentialManager
import com.pathpulse.driver.network.ApiException
import com.pathpulse.driver.network.AuthRepository
import com.pathpulse.driver.network.DataRepository
import com.pathpulse.driver.network.HealthResponse
import com.pathpulse.driver.network.OffRampSession
import com.pathpulse.driver.network.SessionUser
import com.pathpulse.driver.network.SettlementBatch
import com.pathpulse.driver.ui.DashboardScreen
import com.pathpulse.driver.ui.LandingScreen
import com.pathpulse.driver.ui.PENDING_GOOGLE
import com.pathpulse.driver.ui.PENDING_GUEST
import com.pathpulse.driver.ui.PlaceholderScreen
import com.pathpulse.driver.ui.ProfileSheet
import com.pathpulse.driver.ui.SignInScreen
import com.pathpulse.driver.ui.sessionLabel
import com.pathpulse.driver.ui.shell.AppShell
import com.pathpulse.driver.ui.shell.PpTab
import com.pathpulse.driver.ui.theme.PathPulseTheme
import com.pathpulse.driver.ui.theme.PpBackground
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

private const val TAG = "PathPulse"

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            PathPulseTheme {
                Surface(modifier = Modifier.fillMaxSize(), color = PpBackground) {
                    AppRoot()
                }
            }
        }
    }
}

private fun describe(e: Exception): String = when (e) {
    is ApiException -> e.apiError.message
    else -> e.message ?: e.javaClass.simpleName
}

@Composable
fun AppRoot() {
    val authRepository = remember { AuthRepository() }
    val dataRepository = remember { DataRepository() }
    val context = LocalContext.current
    val credentialManager = remember { CredentialManager.create(context) }
    val scope = rememberCoroutineScope()

    var user by remember { mutableStateOf<SessionUser?>(null) }
    var checkingSession by remember { mutableStateOf(true) }
    var showLanding by remember { mutableStateOf(true) }
    var pending by remember { mutableStateOf<String?>(null) }
    var authError by remember { mutableStateOf<String?>(null) }

    var selectedTab by remember { mutableStateOf(PpTab.Dashboard) }
    var profileOpen by remember { mutableStateOf(false) }

    var health by remember { mutableStateOf<HealthResponse?>(null) }
    val batches = remember { mutableStateListOf<SettlementBatch>() }
    val sessions = remember { mutableStateListOf<OffRampSession>() }
    var dataLoading by remember { mutableStateOf(false) }
    var dataError by remember { mutableStateOf<String?>(null) }

    suspend fun loadData() {
        dataLoading = true
        dataError = null
        try {
            coroutineScope {
                val healthJob = async { runCatching { dataRepository.health() }.getOrNull() }
                val batchJob = async { dataRepository.settlementBatches() }
                val sessionJob = async { runCatching { dataRepository.offRampSessions() }.getOrNull() }
                health = healthJob.await()
                batches.also { it.clear() }.addAll(batchJob.await().items)
                sessions.also { it.clear() }.addAll(sessionJob.await()?.items.orEmpty())
            }
        } catch (e: Exception) {
            Log.e(TAG, "dashboard load failed", e)
            dataError = describe(e)
        } finally {
            dataLoading = false
        }
    }

    LaunchedEffect(Unit) {
        try {
            user = authRepository.me()
        } catch (e: Exception) {
            Log.e(TAG, "auth/me failed", e)
        } finally {
            checkingSession = false
        }
    }

    val current = user

    LaunchedEffect(current?.userId) {
        if (current != null) loadData()
    }

    when {
        checkingSession -> LoadingScreen()

        current != null -> {
            AppShell(
                selectedTab = selectedTab,
                onSelectTab = { selectedTab = it },
                health = health,
                avatarInitial = sessionLabel(current).take(1).uppercase(),
                onOpenProfile = { profileOpen = true },
            ) { contentModifier ->
                when (selectedTab) {
                    PpTab.Dashboard -> DashboardScreen(
                        batches = batches,
                        sessions = sessions,
                        loading = dataLoading,
                        error = dataError,
                        onRefresh = { scope.launch { loadData() } },
                        modifier = contentModifier,
                    )
                    PpTab.Settlement -> PlaceholderScreen(
                        title = "Settlement",
                        message = "Creating settlement batches and bulk payouts is available in the web console.",
                        modifier = contentModifier,
                    )
                    PpTab.Scout -> PlaceholderScreen(
                        title = "SCOUT",
                        message = "Reputation tiers and multiplier assignment are available in the web console.",
                        modifier = contentModifier,
                    )
                    PpTab.OffRamp -> PlaceholderScreen(
                        title = "Off-ramp",
                        message = "Fiat withdrawals run through the hosted SEP-24 flow in the web console.",
                        modifier = contentModifier,
                    )
                    PpTab.Treasury -> PlaceholderScreen(
                        title = "Treasury",
                        message = "Multisig thresholds and signer management are available in the web console.",
                        modifier = contentModifier,
                    )
                }
            }

            if (profileOpen) {
                ProfileSheet(
                    user = current,
                    onDismiss = { profileOpen = false },
                    onSignOut = {
                        profileOpen = false
                        scope.launch {
                            runCatching { authRepository.logout() }
                            user = null
                            selectedTab = PpTab.Dashboard
                            batches.clear()
                            sessions.clear()
                            health = null
                            dataError = null
                            authError = null
                            showLanding = true
                        }
                    },
                )
            }
        }

        showLanding -> LandingScreen(onGetStarted = { showLanding = false })

        else -> SignInScreen(
            credentialManager = credentialManager,
            pending = pending,
            error = authError,
            onPendingGoogle = {
                pending = PENDING_GOOGLE
                authError = null
            },
            onIdToken = { idToken ->
                try {
                    authRepository.verifyGoogleIdToken(idToken)
                    user = authRepository.me()
                } catch (e: Exception) {
                    Log.e(TAG, "google verify failed", e)
                    authError = describe(e)
                } finally {
                    pending = null
                }
            },
            onGuest = {
                pending = PENDING_GUEST
                authError = null
                try {
                    authRepository.continueAsGuest()
                    user = authRepository.me()
                } catch (e: Exception) {
                    Log.e(TAG, "guest login failed", e)
                    authError = describe(e)
                } finally {
                    pending = null
                }
            },
            onError = { message ->
                authError = message
                pending = null
            },
        )
    }
}

@Composable
private fun LoadingScreen() {
    Box(
        modifier = Modifier.fillMaxSize().background(PpBackground),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(color = Color.Black, strokeWidth = 2.dp)
    }
}
