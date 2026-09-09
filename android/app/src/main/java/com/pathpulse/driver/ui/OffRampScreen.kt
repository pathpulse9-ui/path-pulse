package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.pathpulse.driver.network.CarretLimits
import com.pathpulse.driver.network.DataRepository
import com.pathpulse.driver.network.OffRampSession
import com.pathpulse.driver.ui.theme.PpMint26
import com.pathpulse.driver.ui.theme.PpMintInk
import com.pathpulse.driver.ui.theme.PpRed100
import com.pathpulse.driver.ui.components.PpCard
import com.pathpulse.driver.ui.components.PpCardHeader
import com.pathpulse.driver.ui.components.PpDivider
import com.pathpulse.driver.ui.components.PpEmptyState
import com.pathpulse.driver.ui.components.PpSquareBadge
import com.pathpulse.driver.ui.theme.PpAccentAmber
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpBlack70
import com.pathpulse.driver.ui.theme.PpGreen500
import com.pathpulse.driver.ui.theme.PpPillShape
import com.pathpulse.driver.ui.theme.PpRed500
import com.pathpulse.driver.ui.theme.PpRed600
import com.pathpulse.driver.ui.theme.PpSize
import com.pathpulse.driver.ui.theme.PpSpace
import com.pathpulse.driver.ui.theme.PpTeal50
import com.pathpulse.driver.ui.theme.PpTeal700

@Composable
fun OffRampScreen(
    sessions: List<OffRampSession>,
    loading: Boolean,
    error: String?,
    onRefresh: () -> Unit,
    onOpenKyc: () -> Unit = {},
    modifier: Modifier = Modifier,
    dataRepository: DataRepository = remember { DataRepository() },
) {
    // PAT-80: Carret daily-limit chip.
    var limits by remember { mutableStateOf<CarretLimits?>(null) }
    LaunchedEffect(Unit) {
        limits = runCatching { dataRepository.carretLimits() }.getOrNull()
    }

    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PpSize.screenPadding)
            .padding(bottom = PpSpace.xxl),
        verticalArrangement = Arrangement.spacedBy(PpSpace.md),
    ) {
        PpTabHeader(title = "Off-ramp", loading = loading, onRefresh = onRefresh)

        if (error != null) {
            PpCard {
                Text(error, style = MaterialTheme.typography.bodyMedium, color = PpRed600)
            }
        }

        // PAT-79: KYC entry banner.
        PpCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("Complete driver KYC", style = MaterialTheme.typography.titleMedium)
                    Text(
                        "PAN → Aadhaar XML → Selfie → verified. Required before you can withdraw INR.",
                        style = MaterialTheme.typography.bodySmall,
                        color = PpBlack70,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
                com.pathpulse.driver.ui.components.PpPrimaryButton(
                    text = "Start",
                    onClick = onOpenKyc,
                    fillWidth = false,
                    modifier = Modifier.padding(start = PpSpace.md),
                )
            }
        }

        limits?.let { l ->
            val ok = l.remaining.withdraw_inr > 0
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .clip(PpPillShape)
                        .background(if (ok) PpMint26 else PpRed100)
                        .padding(horizontal = PpSpace.md, vertical = 4.dp),
                ) {
                    Text(
                        "₹${l.remaining.withdraw_inr.toInt()} available today",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (ok) PpMintInk else PpRed600,
                    )
                }
                Text(
                    "of ₹${l.dailyCapInr.toInt()} Carret daily cap",
                    style = MaterialTheme.typography.bodySmall,
                    color = PpBlack40,
                    modifier = Modifier.padding(start = PpSpace.sm),
                )
            }
        }

        PpCard {
            PpCardHeader(
                title = "${sessions.size} session${if (sessions.size == 1) "" else "s"}",
                subtitle = "Providers: Carret Infra (live, INR corridor) · Ramp (sandbox).",
            )

            if (sessions.isEmpty() && !loading) {
                PpEmptyState(
                    title = "No off-ramp sessions yet",
                    message = "Trigger an off-ramp from the web console and it lands here.",
                )
            } else {
                Column(modifier = Modifier.padding(top = PpSpace.sm)) {
                    sessions.forEachIndexed { i, s ->
                        if (i > 0) PpDivider()
                        OffRampRow(session = s)
                    }
                }
            }
        }
    }
}

@Composable
private fun OffRampRow(session: OffRampSession) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = PpSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PpSquareBadge(text = "OR", background = PpTeal50, contentColor = PpTeal700)
        Column(modifier = Modifier.padding(start = PpSpace.md).weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    session.provider.replaceFirstChar { it.uppercase() },
                    style = MaterialTheme.typography.bodyMedium,
                )
                Box(modifier = Modifier.padding(start = PpSpace.sm)) {
                    StatusPill(status = session.status)
                }
            }
            Text(
                "→ ${session.fiatCurrency}",
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack40,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                "${session.amount} ${session.asset.code}",
                style = MaterialTheme.typography.bodyMedium,
                color = PpBlack70,
            )
            Text(
                session.createdAt.take(10),
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack40,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

@Composable
private fun StatusPill(status: String) {
    val color = statusColor(status)
    Row(
        modifier = Modifier
            .clip(PpPillShape)
            .background(color.copy(alpha = 0.12f))
            .padding(horizontal = PpSpace.sm, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.size(6.dp).clip(CircleShape).background(color))
        Text(
            status.replace('_', ' '),
            style = MaterialTheme.typography.labelSmall,
            color = PpBlack70,
            modifier = Modifier.padding(start = 6.dp),
        )
    }
}

private fun statusColor(status: String): Color {
    val s = status.lowercase()
    return when {
        "fill" in s || "complete" in s || "success" in s -> PpGreen500
        "fail" in s || "cancel" in s || "reject" in s -> PpRed500
        else -> PpAccentAmber
    }
}
