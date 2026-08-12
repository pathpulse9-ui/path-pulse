package com.pathpulse.driver

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.credentials.CredentialManager
import com.pathpulse.driver.network.ApiException
import com.pathpulse.driver.network.AuthRepository
import com.pathpulse.driver.network.SessionUser
import com.pathpulse.driver.ui.DashboardScreen
import com.pathpulse.driver.ui.LandingScreen
import com.pathpulse.driver.ui.SignInScreen
import com.pathpulse.driver.ui.theme.PathPulseTheme
import kotlinx.coroutines.launch

private const val PENDING_GOOGLE = "google"
private const val PENDING_GUEST = "guest"

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            PathPulseTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AppRoot()
                }
            }
        }
    }
}

@Composable
fun AppRoot() {
    val authRepository = remember { AuthRepository() }
    val context = LocalContext.current
    val credentialManager = remember { CredentialManager.create(context) }
    val scope = rememberCoroutineScope()

    var user by remember { mutableStateOf<SessionUser?>(null) }
    var checkingSession by remember { mutableStateOf(true) }
    var showLanding by remember { mutableStateOf(true) }
    var pending by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        checkingSession = true
        try {
            user = authRepository.me()
        } catch (e: Exception) {
            android.util.Log.e("PathPulse", "auth/me failed", e)
            error = "${e.javaClass.simpleName}: ${e.message}"
        } finally {
            checkingSession = false
        }
    }

    val current = user
    when {
        checkingSession -> Unit
        current != null -> DashboardScreen(
            user = current,
            onSignOut = {
                scope.launch {
                    authRepository.logout()
                    user = null
                    showLanding = true
                }
            },
        )
        showLanding -> LandingScreen(onGetStarted = { showLanding = false })
        else -> SignInScreen(
            credentialManager = credentialManager,
            pending = pending,
            error = error,
            onIdToken = { idToken ->
                pending = PENDING_GOOGLE
                error = null
                try {
                    authRepository.verifyGoogleIdToken(idToken)
                    user = authRepository.me()
                } catch (e: ApiException) {
                    android.util.Log.e("PathPulse", "google verify failed", e)
                    error = e.apiError.message
                } catch (e: Exception) {
                    android.util.Log.e("PathPulse", "google verify failed", e)
                    error = "${e.javaClass.simpleName}: ${e.message}"
                } finally {
                    pending = null
                }
            },
            onGuest = {
                pending = PENDING_GUEST
                error = null
                try {
                    authRepository.continueAsGuest()
                    user = authRepository.me()
                } catch (e: Exception) {
                    android.util.Log.e("PathPulse", "guest login failed", e)
                    error = "${e.javaClass.simpleName}: ${e.message}"
                } finally {
                    pending = null
                }
            },
            onError = { message ->
                error = message
                pending = null
            },
        )
    }
}
