package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.pathpulse.driver.network.SettlementBatch
import com.pathpulse.driver.ui.components.PpCard
import com.pathpulse.driver.ui.components.PpCardHeader
import com.pathpulse.driver.ui.components.PpDivider
import com.pathpulse.driver.ui.components.PpEmptyState
import com.pathpulse.driver.ui.components.PpSquareBadge
import com.pathpulse.driver.ui.icons.PpIcons
import com.pathpulse.driver.ui.theme.PpBlack05
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpBlack50
import com.pathpulse.driver.ui.theme.PpBlack70
import com.pathpulse.driver.ui.theme.PpBlue50
import com.pathpulse.driver.ui.theme.PpBlue700
import com.pathpulse.driver.ui.theme.PpMint
import com.pathpulse.driver.ui.theme.PpMint26
import com.pathpulse.driver.ui.theme.PpMint58
import com.pathpulse.driver.ui.theme.PpMintInk
import com.pathpulse.driver.ui.theme.PpRed600
import com.pathpulse.driver.ui.theme.PpPillShape
import com.pathpulse.driver.ui.theme.PpSize
import com.pathpulse.driver.ui.theme.PpSpace

private fun short(a: String) =
    if (a.length <= 12) a else "${a.take(6)}…${a.takeLast(4)}"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettlementScreen(
    batches: List<SettlementBatch>,
    loading: Boolean,
    error: String?,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var selected by remember { mutableStateOf<SettlementBatch?>(null) }

    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PpSize.screenPadding)
            .padding(bottom = PpSpace.xxl),
        verticalArrangement = Arrangement.spacedBy(PpSpace.md),
    ) {
        PpTabHeader(title = "Settlement", loading = loading, onRefresh = onRefresh)

        if (error != null) {
            PpCard {
                Text(error, style = MaterialTheme.typography.bodyMedium, color = PpRed600)
            }
        }

        PpCard {
            PpCardHeader(
                title = "${batches.size} batch${if (batches.size == 1) "" else "es"}",
                subtitle = "Newest first. Tap a row for driver-payout detail + Horizon link.",
            )

            if (batches.isEmpty() && !loading) {
                PpEmptyState(
                    title = "No settlement activity yet",
                    message = "Run a settlement batch and it shows up here.",
                )
            } else {
                Column(modifier = Modifier.padding(top = PpSpace.sm)) {
                    batches.forEachIndexed { i, b ->
                        if (i > 0) PpDivider()
                        SettlementRow(
                            batch = b,
                            onClick = { selected = b },
                        )
                    }
                }
            }
        }
    }

    val current = selected
    if (current != null) {
        ModalBottomSheet(
            onDismissRequest = { selected = null },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        ) {
            SettlementDetailContent(batch = current)
        }
    }
}

@Composable
private fun SettlementRow(batch: SettlementBatch, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = PpSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PpSquareBadge(text = "ST", background = PpBlue50, contentColor = PpBlue700)
        Column(modifier = Modifier.padding(start = PpSpace.md).weight(1f)) {
            Text(
                "${batch.grossAmount} ${batch.asset.code}",
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
            )
            Text(
                short(batch.txHash),
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack40,
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(
                batch.createdAt.take(10),
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack40,
            )
            Icon(
                PpIcons.ArrowRight,
                contentDescription = null,
                tint = PpBlack40,
                modifier = Modifier.padding(top = 2.dp).size(14.dp),
            )
        }
    }
}

@Composable
private fun SettlementDetailContent(batch: SettlementBatch) {
    Column(
        modifier = Modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PpSize.screenPadding)
            .padding(bottom = PpSpace.xxl),
        verticalArrangement = Arrangement.spacedBy(PpSpace.md),
    ) {
        Text(
            "Settlement batch",
            style = MaterialTheme.typography.headlineSmall,
            modifier = Modifier.padding(top = PpSpace.sm),
        )

        PpCard {
            PpCardHeader(title = "Split", subtitle = "${batch.grossAmount} ${batch.asset.code} gross")
            Column(
                modifier = Modifier.padding(top = PpSpace.md),
                verticalArrangement = Arrangement.spacedBy(PpSpace.md),
            ) {
                SplitLine(color = PpMint,   label = "Authorities (50%)",    amount = batch.split.authorities)
                SplitLine(color = PpMint58, label = "Driver rewards (30%)", amount = batch.split.driverRewards)
                SplitLine(color = PpMint26, label = "Treasury (20%)",       amount = batch.split.treasury)
            }
        }

        if (batch.driverPayouts.isNotEmpty()) {
            PpCard {
                PpCardHeader(
                    title = "Driver payouts",
                    subtitle = "${batch.driverPayouts.size} driver${if (batch.driverPayouts.size == 1) "" else "s"}",
                )
                Column(modifier = Modifier.padding(top = PpSpace.sm)) {
                    batch.driverPayouts.forEachIndexed { i, p ->
                        if (i > 0) PpDivider()
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = PpSpace.md),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(
                                modifier = Modifier
                                    .clip(PpPillShape)
                                    .background(scoutColor(p.tier))
                                    .padding(horizontal = PpSpace.sm, vertical = 3.dp),
                            ) {
                                Text(
                                    "SCOUT${p.tier}",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = PpMintInk,
                                )
                            }
                            Column(modifier = Modifier.padding(start = PpSpace.md).weight(1f)) {
                                Text(p.userId, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
                                Text(
                                    short(p.address),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = PpBlack40,
                                    fontFamily = FontFamily.Monospace,
                                    modifier = Modifier.padding(top = 2.dp),
                                )
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                Text(p.amount, style = MaterialTheme.typography.bodyMedium)
                                Text(
                                    String.format("%.1f×", p.multiplier),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = PpBlack40,
                                    modifier = Modifier.padding(top = 2.dp),
                                )
                            }
                        }
                    }
                }
            }
        }

        PpCard {
            PpCardHeader(title = "On-chain")
            Column(
                modifier = Modifier.padding(top = PpSpace.md),
                verticalArrangement = Arrangement.spacedBy(PpSpace.sm),
            ) {
                InfoRow(label = "Batch id", value = batch.id, mono = true)
                InfoRow(label = "Tx hash",  value = batch.txHash, mono = true)
                InfoRow(label = "Network",  value = batch.network, mono = false)
                if (!batch.sourceAddress.isNullOrEmpty()) {
                    InfoRow(label = "Source", value = batch.sourceAddress, mono = true)
                }
            }
        }
    }
}

@Composable
private fun SplitLine(color: Color, label: String, amount: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(modifier = Modifier.size(10.dp).clip(CircleShape).background(color))
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = PpBlack70,
            modifier = Modifier.padding(start = PpSpace.sm).weight(1f),
        )
        Text(amount, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun InfoRow(label: String, value: String, mono: Boolean) {
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

private fun scoutColor(tier: Int): Color = when (tier) {
    1 -> PpMint26
    2 -> PpMint58
    else -> PpMint
}
