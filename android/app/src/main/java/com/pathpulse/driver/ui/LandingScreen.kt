package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pathpulse.driver.ui.theme.PathPulseTheme
import com.pathpulse.driver.ui.theme.PpBackground
import com.pathpulse.driver.ui.theme.PpBlack70
import com.pathpulse.driver.ui.theme.PpPillShape

@Composable
fun LandingScreen(onGetStarted: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(PpBackground)
            .padding(horizontal = 32.dp),
    ) {
        Column(
            modifier = Modifier.align(Alignment.Center),
            horizontalAlignment = Alignment.Start,
        ) {
            Text(
                "PathPulse",
                fontSize = 22.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier.padding(bottom = 56.dp),
            )

            Text(
                "Settlement,\nMade Verifiable",
                fontSize = 40.sp,
                fontWeight = FontWeight.Medium,
                lineHeight = 44.sp,
                letterSpacing = (-1).sp,
                modifier = Modifier.padding(bottom = 16.dp),
            )

            Text(
                "Stellar-based settlement infrastructure for institutional reward and payout " +
                    "programs — deterministic on-chain splits, multisig treasury controls, and a " +
                    "full audit trail from treasury to recipient.",
                fontSize = 16.sp,
                lineHeight = 22.sp,
                color = PpBlack70,
                modifier = Modifier.padding(bottom = 40.dp),
            )

            Button(
                onClick = onGetStarted,
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = PpPillShape,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color.Black,
                    contentColor = Color.White,
                ),
            ) {
                Text("Get started", fontSize = 14.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun LandingScreenPreview() {
    PathPulseTheme {
        LandingScreen(onGetStarted = {})
    }
}
