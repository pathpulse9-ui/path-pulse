package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.pathpulse.driver.ui.components.PpArrowButton
import com.pathpulse.driver.ui.components.PpLegendSwatch
import com.pathpulse.driver.ui.components.PpMarquee
import com.pathpulse.driver.ui.components.PpPrimaryButton
import com.pathpulse.driver.ui.theme.PathPulseTheme
import com.pathpulse.driver.ui.theme.PpAccentAmber
import com.pathpulse.driver.ui.theme.PpAccentBlue
import com.pathpulse.driver.ui.theme.PpAccentTeal
import com.pathpulse.driver.ui.theme.PpBackground
import com.pathpulse.driver.ui.theme.PpBlack50
import com.pathpulse.driver.ui.theme.PpBlack70
import com.pathpulse.driver.ui.theme.PpCardShape
import com.pathpulse.driver.ui.theme.PpInk
import com.pathpulse.driver.ui.theme.PpSpace
import com.pathpulse.driver.ui.theme.PpSurface
import com.pathpulse.driver.ui.theme.PpWhite60

private val PILLARS = listOf(
    PpAccentBlue to "Deterministic on-chain splits",
    PpAccentAmber to "Multisig treasury controls",
    PpAccentTeal to "Audit trail, treasury to recipient",
)

private val ECOSYSTEM = listOf(
    "Freighter", "LOBSTR", "xBull", "ALBEDO", "Horizon", "Stellar", "SEP-10",
)

private val PARTNERS = listOf(
    "Meridian Capital", "NORTHLIGHT", "ANCHOR", "Vale Digital",
    "Cordant Labs", "BRIGHTLINE", "FATHOM", "Solace Partners",
)

@Composable
fun LandingScreen(onGetStarted: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(PpBackground)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PpSpace.xxl),
    ) {
        Text(
            "PathPulse",
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.padding(top = PpSpace.xxl, bottom = PpSpace.xxxl),
        )

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
            modifier = Modifier.padding(bottom = PpSpace.xl),
        )

        PpArrowButton(
            text = "Request access",
            onClick = onGetStarted,
            modifier = Modifier.padding(bottom = PpSpace.xxl),
        )

        Column(
            verticalArrangement = Arrangement.spacedBy(PpSpace.md),
            modifier = Modifier.padding(bottom = PpSpace.xxl),
        ) {
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

        PpMarquee(
            items = ECOSYSTEM,
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = PpSpace.xxxl),
        )

        Text(
            "Meet PathPulse.",
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.padding(bottom = PpSpace.md),
        )

        Text(
            "A deterministic revenue split, enforced on-chain, with full " +
                "treasury-to-recipient traceability for the institutions and governments " +
                "that depend on it.",
            style = MaterialTheme.typography.bodyMedium,
            color = PpBlack70,
            modifier = Modifier.padding(bottom = PpSpace.xl),
        )

        FeatureCard(
            title = "Splits enforced on-chain",
            body = "Every batch computes a deterministic 50/30/20 split — Authorities, " +
                "Driver Pool, Treasury — settled as one verifiable Stellar transaction.",
            background = PpSurface,
            titleColor = Color.Black,
            bodyColor = PpBlack70,
        )

        Spacer(modifier = Modifier.height(PpSpace.md))

        FeatureCard(
            title = "Traceable,\ntreasury to recipient.",
            body = "Every settlement batch is auditable end-to-end — treasury deposit to " +
                "individual payout — for partner and government review.",
            background = PpInk,
            titleColor = Color.White,
            bodyColor = PpWhite60,
        )

        Spacer(modifier = Modifier.height(PpSpace.md))

        FeatureCard(
            title = "Human-gated\nat every key step",
            body = "Multisig treasury, automated settlement — but mainnet actions are never " +
                "auto-signed. Every key step keeps a human in the loop.",
            background = PpInk,
            titleColor = Color.White,
            bodyColor = PpWhite60,
        )

        Text(
            "Built for institutions,\nauditable by design.",
            style = MaterialTheme.typography.bodyLarge,
            color = PpBlack70,
            modifier = Modifier.padding(top = PpSpace.xxxl, bottom = PpSpace.lg),
        )

        PpMarquee(
            items = PARTNERS,
            durationMillis = 30_000,
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = PpSpace.xxxl),
        )

        PpPrimaryButton(
            text = "Get started",
            onClick = onGetStarted,
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = PpSpace.xxl),
        )
    }
}

@Composable
private fun FeatureCard(
    title: String,
    body: String,
    background: Color,
    titleColor: Color,
    bodyColor: Color,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(PpCardShape)
            .background(background)
            .padding(PpSpace.xl),
        verticalArrangement = Arrangement.spacedBy(PpSpace.xxxl),
    ) {
        Text(title, style = MaterialTheme.typography.titleLarge, color = titleColor)
        Text(body, style = MaterialTheme.typography.bodyMedium, color = bodyColor)
    }
}

@Preview(showBackground = true, backgroundColor = 0xFFF5F5F5, heightDp = 1600)
@Composable
private fun LandingScreenPreview() {
    PathPulseTheme {
        LandingScreen(onGetStarted = {})
    }
}
