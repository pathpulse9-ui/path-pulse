package com.pathpulse.driver.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.pathpulse.driver.Config
import com.pathpulse.driver.ui.theme.PathPulseTheme
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpBlack10
import com.pathpulse.driver.ui.theme.PpBlack60
import com.pathpulse.driver.ui.theme.PpBackground
import com.pathpulse.driver.ui.theme.PpPillShape
import com.pathpulse.driver.ui.theme.PpRed700
import kotlinx.coroutines.launch

private const val PENDING_GOOGLE = "google"
private const val PENDING_GUEST = "guest"

@Composable
fun SignInScreen(
    credentialManager: CredentialManager,
    pending: String?,
    error: String?,
    onIdToken: suspend (String) -> Unit,
    onGuest: suspend () -> Unit,
    onError: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val busy = pending != null

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(PpBackground)
            .padding(horizontal = 32.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.Start) {
            Text(
                "PathPulse",
                fontSize = 22.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(bottom = 48.dp),
            )

            Text(
                "Settlement starts here",
                fontSize = 34.sp,
                fontWeight = FontWeight.Medium,
                lineHeight = 38.sp,
                letterSpacing = (-0.8).sp,
                modifier = Modifier.padding(bottom = 12.dp),
            )

            Text(
                "Sign in to continue, or browse the console as a guest.",
                fontSize = 16.sp,
                color = PpBlack60,
                modifier = Modifier.padding(bottom = 40.dp),
            )

            Button(
                onClick = {
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
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = PpPillShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color.Black,
                    contentColor = Color.White,
                ),
            ) {
                Text(
                    if (pending == PENDING_GOOGLE) "Signing in…" else "Continue with Google",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                )
            }

            OutlinedButton(
                onClick = { scope.launch { onGuest() } },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().height(48.dp).padding(top = 12.dp),
                shape = PpPillShape,
                border = BorderStroke(1.dp, SolidColor(PpBlack10)),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.Black),
            ) {
                Text(
                    if (pending == PENDING_GUEST) "Starting…" else "Continue as Guest",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                )
            }

            Text(
                "Guests get read-only access — no wallet, no payouts, no off-ramp.",
                fontSize = 12.sp,
                color = PpBlack40,
                modifier = Modifier.padding(top = 12.dp),
            )

            if (error != null) {
                Text(
                    error,
                    color = PpRed700,
                    fontSize = 14.sp,
                    modifier = Modifier.padding(top = 20.dp),
                )
            }

            Text(
                "By continuing, you agree to our Terms and Privacy Policy.",
                fontSize = 12.sp,
                color = PpBlack40,
                textAlign = TextAlign.Start,
                modifier = Modifier.padding(top = 32.dp),
            )
        }
    }
}

@Preview(showBackground = true)
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
        )
    }
}

@Preview(showBackground = true, name = "Signing in")
@Composable
private fun SignInScreenLoadingPreview() {
    val context = LocalContext.current
    PathPulseTheme {
        SignInScreen(
            credentialManager = CredentialManager.create(context),
            pending = PENDING_GOOGLE,
            error = null,
            onIdToken = {},
            onGuest = {},
            onError = {},
        )
    }
}
