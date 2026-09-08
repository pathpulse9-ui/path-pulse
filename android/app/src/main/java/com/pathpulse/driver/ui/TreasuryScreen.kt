package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.pathpulse.driver.network.DistributionAccount
import com.pathpulse.driver.network.TreasuryConfig
import com.pathpulse.driver.ui.components.PpCard
import com.pathpulse.driver.ui.components.PpCardHeader
import com.pathpulse.driver.ui.components.PpDivider
import com.pathpulse.driver.ui.theme.PpBlack05
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpBlack70
import com.pathpulse.driver.ui.theme.PpMint26
import com.pathpulse.driver.ui.theme.PpMintInk
import com.pathpulse.driver.ui.theme.PpPillShape
import com.pathpulse.driver.ui.theme.PpRed100
import com.pathpulse.driver.ui.theme.PpRed600
import com.pathpulse.driver.ui.theme.PpSize
import com.pathpulse.driver.ui.theme.PpSpace
import com.pathpulse.driver.ui.theme.PpTileShape

@Composable
fun TreasuryScreen(
    config: TreasuryConfig?,
    accounts: List<DistributionAccount>,
    loading: Boolean,
    error: String?,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PpSize.screenPadding)
            .padding(bottom = PpSpace.xxl),
        verticalArrangement = Arrangement.spacedBy(PpSpace.md),
    ) {
        PpTabHeader(title = "Treasury", loading = loading, onRefresh = onRefresh)

        if (error != null) {
            PpCard {
                Text(error, style = MaterialTheme.typography.bodyMedium, color = PpRed600)
            }
        }

        PpCard {
            PpCardHeader(
                title = "Treasury multisig",
                subtitle = "Master key at weight 0 disables direct signing; N-of-M signers required.",
            )
            if (config != null) {
                Column(
                    modifier = Modifier.padding(top = PpSpace.md),
                    verticalArrangement = Arrangement.spacedBy(PpSpace.md),
                ) {
                    InfoField("Public key", config.publicKey, mono = true)
                    InfoField("Network",    config.network,   mono = false)
                    Row(horizontalArrangement = Arrangement.spacedBy(PpSpace.md)) {
                        ThresholdChip("Low",    config.thresholds.low,    Modifier.weight(1f))
                        ThresholdChip("Medium", config.thresholds.medium, Modifier.weight(1f))
                        ThresholdChip("High",   config.thresholds.high,   Modifier.weight(1f))
                    }
                }
                PpDivider(modifier = Modifier.padding(vertical = PpSpace.md))
                Text(
                    "Signers (${config.signers.size})",
                    style = MaterialTheme.typography.labelMedium,
                    color = PpBlack40,
                )
                Column(modifier = Modifier.padding(top = PpSpace.sm)) {
                    config.signers.forEachIndexed { i, s ->
                        if (i > 0) PpDivider()
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = PpSpace.md),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                shortAddr(s.publicKey),
                                style = MaterialTheme.typography.bodySmall,
                                color = PpBlack70,
                                fontFamily = FontFamily.Monospace,
                                modifier = Modifier.weight(1f),
                            )
                            WeightBadge(weight = s.weight)
                        }
                    }
                }
            } else if (loading) {
                Text(
                    "Loading…",
                    style = MaterialTheme.typography.bodySmall,
                    color = PpBlack40,
                    modifier = Modifier.padding(top = PpSpace.lg),
                )
            }
        }

        PpCard {
            PpCardHeader(
                title = "Distribution accounts",
                subtitle = "Destinations for the 50/30/20 settlement split.",
            )
            if (accounts.isEmpty() && loading) {
                Text(
                    "Loading…",
                    style = MaterialTheme.typography.bodySmall,
                    color = PpBlack40,
                    modifier = Modifier.padding(top = PpSpace.lg),
                )
            } else {
                Column(modifier = Modifier.padding(top = PpSpace.sm)) {
                    accounts.forEachIndexed { i, a ->
                        if (i > 0) PpDivider()
                        Column(modifier = Modifier.fillMaxWidth().padding(vertical = PpSpace.md)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(a.label(), style = MaterialTheme.typography.bodyMedium)
                                if (a.multisig) {
                                    Box(
                                        modifier = Modifier
                                            .padding(start = PpSpace.sm)
                                            .clip(PpPillShape)
                                            .background(PpMint26)
                                            .padding(horizontal = PpSpace.sm, vertical = 3.dp),
                                    ) {
                                        Text(
                                            "multisig",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = PpMintInk,
                                        )
                                    }
                                }
                            }
                            Text(
                                shortAddr(a.publicKey),
                                style = MaterialTheme.typography.bodySmall,
                                color = PpBlack70,
                                fontFamily = FontFamily.Monospace,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun InfoField(label: String, value: String, mono: Boolean) {
    Column {
        Text(label, style = MaterialTheme.typography.labelSmall, color = PpBlack40)
        Text(
            value,
            style = MaterialTheme.typography.bodySmall,
            color = PpBlack70,
            fontFamily = if (mono) FontFamily.Monospace else null,
            modifier = Modifier.padding(top = 2.dp),
        )
    }
}

@Composable
private fun ThresholdChip(label: String, value: Int, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(PpTileShape)
            .background(PpBlack05)
            .padding(PpSpace.md),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = PpBlack40)
        Text("$value", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 2.dp))
    }
}

@Composable
private fun WeightBadge(weight: Int) {
    val disabled = weight == 0
    Box(
        modifier = Modifier
            .clip(PpPillShape)
            .background(if (disabled) PpRed100 else PpMint26)
            .padding(horizontal = PpSpace.sm, vertical = 3.dp),
    ) {
        Text(
            "weight $weight",
            style = MaterialTheme.typography.labelSmall,
            color = if (disabled) PpRed600 else PpMintInk,
        )
    }
}

private fun shortAddr(a: String): String =
    if (a.length <= 14) a else "${a.take(6)}…${a.takeLast(6)}"

private fun DistributionAccount.label(): String = when (role) {
    "partner_revenue" -> "Authorities (50%)"
    "driver_pool"     -> "Driver pool (30%)"
    "treasury"        -> "Treasury (20%)"
    else              -> role.replace('_', ' ').replaceFirstChar { it.uppercase() }
}
