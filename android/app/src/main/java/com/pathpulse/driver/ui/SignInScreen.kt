package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.tooling.preview.Preview
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.pathpulse.driver.Config
import com.pathpulse.driver.ui.components.PpPrimaryButton
import com.pathpulse.driver.ui.components.PpSecondaryButton
import com.pathpulse.driver.ui.theme.PathPulseTheme
import com.pathpulse.driver.ui.theme.PpBackground
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpBlack60
import com.pathpulse.driver.ui.theme.PpRed100
import com.pathpulse.driver.ui.theme.PpRed700
import com.pathpulse.driver.ui.theme.PpSpace
import com.pathpulse.driver.ui.theme.PpTileShape
import kotlinx.coroutines.launch

const val PENDING_GOOGLE = "google"
const val PENDING_GUEST = "guest"

@Composable
fun SignInScreen(
    credentialManager: CredentialManager,
    pending: String?,
    error: String?,
    onIdToken: suspend (String) -> Unit,
    onGuest: suspend () -> Unit,
    onError: (String) -> Unit,
    onPendingGoogle: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val busy = pending != null

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(PpBackground)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(horizontal = PpSpace.xxl),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.Start) {
            Text(
                "PathPulse",
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.padding(bottom = PpSpace.xxxl),
            )

            Text(
                "Payments starts here",
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.padding(bottom = PpSpace.md),
            )

            Text(
                "Sign in to continue, or browse the console as a guest.",
                style = MaterialTheme.typography.bodyLarge,
                color = PpBlack60,
                modifier = Modifier.padding(bottom = PpSpace.xxxl),
            )

            PpPrimaryButton(
                text = if (pending == PENDING_GOOGLE) "Signing in…" else "Continue with Google",
                enabled = !busy,
                onClick = {
                    onPendingGoogle()
                    scope.launch {
                        try {
                            val googleIdOption = GetGoogleIdOption.Builder()
                                .setFilterByAuthorizedAccounts(false)
                                .setServerClientId(Config.GOOGLE_WEB_CLIENT_ID)
                                .build()
                            val request = GetCredentialRequest.Builder()
                                .addCredentialOption(googleIdOption)
                                .build()
                            val result = credentialManager.getCredential(context, request)
                            val credential = result.credential
                            if (credential is CustomCredential &&
                                credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                            ) {
                                val googleIdTokenCredential = GoogleIdTokenCredential.createFrom(credential.data)
                                onIdToken(googleIdTokenCredential.idToken)
                            } else {
                                onError("Unexpected credential type")
                            }
                        } catch (e: GetCredentialException) {
                            onError(e.message ?: "Google sign-in failed")
                        }
                    }
                },
            )

            PpSecondaryButton(
                text = if (pending == PENDING_GUEST) "Starting…" else "Continue as Guest",
                enabled = !busy,
                onClick = { scope.launch { onGuest() } },
                modifier = Modifier.padding(top = PpSpace.md),
            )

            Text(
                "Guests get read-only access — no wallet, no payouts, no off-ramp.",
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack40,
                modifier = Modifier.padding(top = PpSpace.md),
            )

            if (error != null) {
                Text(
                    error,
                    style = MaterialTheme.typography.bodyMedium,
                    color = PpRed700,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = PpSpace.xl)
                        .clip(PpTileShape)
                        .background(PpRed100)
                        .padding(PpSpace.md),
                )
            }

            Text(
                "By continuing, you agree to our Terms and Privacy Policy.",
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack40,
                modifier = Modifier.padding(top = PpSpace.xxxl),
            )
        }
    }
}

@Preview(showBackground = true, backgroundColor = 0xFFF5F5F5)
@Composable
private fun SignInScreenPreview() {
    val context = LocalContext.current
    PathPulseTheme {
        SignInScreen(
            credentialManager = CredentialManager.create(context),
            pending = null,
            error = null,
            onIdToken = {},
            onGuest = {},
            onError = {},
            onPendingGoogle = {},
        )
    }
}

@Preview(showBackground = true, backgroundColor = 0xFFF5F5F5, name = "Error")
@Composable
private fun SignInScreenErrorPreview() {
    val context = LocalContext.current
    PathPulseTheme {
        SignInScreen(
            credentialManager = CredentialManager.create(context),
            pending = null,
            error = "Backend Core unreachable. Check that the API is running.",
            onIdToken = {},
            onGuest = {},
            onError = {},
            onPendingGoogle = {},
        )
    }
}
