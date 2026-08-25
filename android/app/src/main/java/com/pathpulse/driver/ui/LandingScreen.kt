package com.pathpulse.driver.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.pathpulse.driver.R
import com.pathpulse.driver.ui.components.PpArrowButton
import com.pathpulse.driver.ui.components.PpMarquee
import com.pathpulse.driver.ui.theme.PathPulseTheme
import com.pathpulse.driver.ui.theme.PpMint
import com.pathpulse.driver.ui.theme.PpMint26
import com.pathpulse.driver.ui.theme.PpMint58
import com.pathpulse.driver.ui.theme.PpBackground
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpBlack50
import com.pathpulse.driver.ui.theme.PpBlack70
import com.pathpulse.driver.ui.theme.PpCardShape
import com.pathpulse.driver.ui.theme.PpPillShape
import com.pathpulse.driver.ui.theme.PpSpace
import com.pathpulse.driver.ui.theme.PpSurface

private data class Leg(val label: String, val share: String, val weight: Float, val color: Color)

private val SPLIT = listOf(
    Leg("Authorities", "50%", 0.5f, PpMint),
    Leg("Driver rewards", "30%", 0.3f, PpMint58),
    Leg("Treasury", "20%", 0.2f, PpMint26),
)

private val ECOSYSTEM = listOf(
    "Freighter", "LOBSTR", "xBull", "ALBEDO", "Horizon", "Soroban", "SEP-10",
)

@Composable
fun LandingScreen(onGetStarted: () -> Unit) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(PpBackground)
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .verticalScroll(rememberScrollState())
                    .heightIn(min = maxHeight)
                    .padding(horizontal = PpSpace.xxl, vertical = PpSpace.xl),
                verticalArrangement = Arrangement.SpaceBetween,
            ) {
                Header()
                Pitch()
                Footer(onGetStarted)
            }
        }
    }
}

@Composable
private fun Header() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Image(
            painter = painterResource(R.drawable.pp_logo),
            contentDescription = null,
            modifier = Modifier.size(28.dp),
        )
        Text(
            "PathPulse",
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier
                .weight(1f)
                .padding(start = PpSpace.md),
        )
        Text(
            "TESTNET",
            style = MaterialTheme.typography.labelSmall,
            color = PpBlack50,
            modifier = Modifier
                .clip(PpPillShape)
                .background(PpSurface)
                .padding(horizontal = PpSpace.md, vertical = 6.dp),
        )
    }
}

@Composable
private fun Pitch() {
    Column(
        verticalArrangement = Arrangement.spacedBy(PpSpace.xs + 2.dp),
        modifier = Modifier.padding(vertical = PpSpace.xxl),
    ) {
        Card {
            Text(
                "Settlement,\nMade Verifiable",
                style = MaterialTheme.typography.displayMedium,
            )
        }

        Card {
            Text(
                "Revenue arrives once. The split is computed on-chain and settled as a single " +
                    "Stellar transaction anyone can verify.",
                style = MaterialTheme.typography.bodyMedium,
                color = PpBlack70,
            )
        }

        SplitCard()

        Card {
            PpMarquee(items = ECOSYSTEM, modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun Card(
    background: Color = PpSurface,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(PpCardShape)
            .background(background)
            .padding(horizontal = PpSpace.xxl, vertical = PpSpace.xl),
        content = content,
    )
}

@Composable
private fun Footer(onGetStarted: () -> Unit) {
    Column {
        PpArrowButton(
            text = "Get started",
            onClick = onGetStarted,
            fillWidth = true,
        )

        Text(
            "Every batch settles to Stellar and is traceable treasury to recipient.",
            style = MaterialTheme.typography.bodySmall,
            color = PpBlack40,
            modifier = Modifier.padding(top = PpSpace.md),
        )
    }
}

@Composable
private fun SplitCard() {
    Card {
        Text(
            "Deterministic split",
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(bottom = PpSpace.lg),
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(10.dp)
                .clip(PpPillShape),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            SPLIT.forEach { leg ->
                Box(
                    modifier = Modifier
                        .weight(leg.weight)
                        .fillMaxSize()
                        .background(leg.color),
                )
            }
        }

        Column(
            verticalArrangement = Arrangement.spacedBy(PpSpace.md),
            modifier = Modifier.padding(top = PpSpace.lg),
        ) {
            SPLIT.forEach { leg ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(PpPillShape)
                            .background(leg.color),
                    )
                    Text(
                        leg.label,
                        style = MaterialTheme.typography.bodyMedium,
                        color = PpBlack70,
                        modifier = Modifier
                            .weight(1f)
                            .padding(start = PpSpace.md),
                    )
                    Text(
                        leg.share,
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
            }
        }
    }
}

@Preview(showBackground = true, backgroundColor = 0xFFF5F5F5)
@Composable
private fun LandingScreenPreview() {
    PathPulseTheme {
        LandingScreen(onGetStarted = {})
    }
}
