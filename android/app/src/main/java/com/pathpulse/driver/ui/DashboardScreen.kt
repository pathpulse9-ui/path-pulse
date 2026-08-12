package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pathpulse.driver.network.SessionUser
import com.pathpulse.driver.ui.theme.PathPulseTheme
import com.pathpulse.driver.ui.theme.PpBackground
import com.pathpulse.driver.ui.theme.PpBlack05
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpBlack50
import com.pathpulse.driver.ui.theme.PpBlack70
import com.pathpulse.driver.ui.theme.PpCardShape
import com.pathpulse.driver.ui.theme.PpPillShape
import com.pathpulse.driver.ui.theme.PpSurface

private val METHOD_LABEL = mapOf("google" to "Google", "wallet" to "Wallet", "guest" to "Guest")

@Composable
fun DashboardScreen(
    user: SessionUser,
    onSignOut: () -> Unit,
) {
    val label = user.email ?: user.address ?: user.userId
    val initial = label.take(1).uppercase()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(PpBackground)
            .padding(24.dp),
    ) {
        Text(
            "Dashboard",
            fontSize = 28.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(bottom = 20.dp),
        )

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(PpCardShape)
                .background(PpSurface)
                .padding(24.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(Color.Black),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(initial, color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                }

                Column(modifier = Modifier.padding(start = 12.dp).weight(1f)) {
                    Text(label, fontSize = 16.sp, color = Color.Black)
                }

                Box(
                    modifier = Modifier
                        .clip(PpPillShape)
                        .background(PpBlack05)
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                ) {
                    Text(
                        (METHOD_LABEL[user.method] ?: user.method).uppercase(),
                        fontSize = 10.sp,
                        color = PpBlack50,
                        letterSpacing = 0.5.sp,
                    )
                }
            }

            if (user.address != null) {
                Text(
                    user.address,
                    fontSize = 12.sp,
                    color = PpBlack40,
                    modifier = Modifier.padding(top = 16.dp),
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 16.dp)
                .clip(PpCardShape)
                .background(PpSurface),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onSignOut)
                    .padding(horizontal = 20.dp)
                    .height(48.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (user.method == "guest") "Exit guest session" else "Sign out",
                    fontSize = 14.sp,
                    color = PpBlack70,
                )
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun DashboardScreenPreview() {
    PathPulseTheme {
        DashboardScreen(
            user = SessionUser(
                userId = "user_123",
                method = "google",
                email = "driver@pathpulse.ai",
                address = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV",
            ),
            onSignOut = {},
        )
    }
}

@Preview(showBackground = true, name = "Guest")
@Composable
private fun DashboardScreenGuestPreview() {
    PathPulseTheme {
        DashboardScreen(
            user = SessionUser(userId = "guest_456", method = "guest"),
            onSignOut = {},
        )
    }
}
