package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.pathpulse.driver.ui.components.PpLegendSwatch
import com.pathpulse.driver.ui.components.PpPrimaryButton
import com.pathpulse.driver.ui.theme.PathPulseTheme
import com.pathpulse.driver.ui.theme.PpAccentAmber
import com.pathpulse.driver.ui.theme.PpAccentBlue
import com.pathpulse.driver.ui.theme.PpAccentTeal
import com.pathpulse.driver.ui.theme.PpBackground
import com.pathpulse.driver.ui.theme.PpBlack50
import com.pathpulse.driver.ui.theme.PpBlack70
import com.pathpulse.driver.ui.theme.PpSpace

private val PILLARS = listOf(
    PpAccentBlue to "Deterministic on-chain splits",
    PpAccentAmber to "Multisig treasury controls",
    PpAccentTeal to "Audit trail, treasury to recipient",
)

@Composable
fun LandingScreen(onGetStarted: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(PpBackground)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(horizontal = PpSpace.xxl),
    ) {
        Text(
            "PathPulse",
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.padding(top = PpSpace.xxl),
        )

        Box(modifier = Modifier.weight(1f))

        Text(
            "Settlement,\nMade Verifiable",
            style = MaterialTheme.typography.displayMedium,
            modifier = Modifier.padding(bottom = PpSpace.lg),
        )

        Text(
            "Stellar-based settlement infrastructure for institutional reward and payout " +
                "programs.",
            style = MaterialTheme.typography.bodyLarge,
            color = PpBlack70,
            modifier = Modifier.padding(bottom = PpSpace.xxl),
        )

        Column(verticalArrangement = Arrangement.spacedBy(PpSpace.md)) {
            PILLARS.forEach { (color, label) ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    PpLegendSwatch(color)
                    Text(
                        label,
                        style = MaterialTheme.typography.bodyMedium,
                        color = PpBlack50,
                        modifier = Modifier.padding(start = PpSpace.md),
                    )
                }
            }
        }

        Box(modifier = Modifier.weight(1f))

        PpPrimaryButton(
            text = "Get started",
            onClick = onGetStarted,
            modifier = Modifier.fillMaxWidth().padding(bottom = PpSpace.xxl),
        )
    }
}

@Preview(showBackground = true, backgroundColor = 0xFFF5F5F5)
@Composable
private fun LandingScreenPreview() {
    PathPulseTheme {
        LandingScreen(onGetStarted = {})
    }
}
