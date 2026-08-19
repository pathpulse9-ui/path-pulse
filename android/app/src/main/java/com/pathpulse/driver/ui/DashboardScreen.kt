package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.pathpulse.driver.network.OffRampSession
import com.pathpulse.driver.network.SettlementBatch
import com.pathpulse.driver.ui.components.PpCard
import com.pathpulse.driver.ui.components.PpCardHeader
import com.pathpulse.driver.ui.components.PpDivider
import com.pathpulse.driver.ui.components.PpEmptyState
import com.pathpulse.driver.ui.components.PpLegendSwatch
import com.pathpulse.driver.ui.components.PpSecondaryButton
import com.pathpulse.driver.ui.components.PpSquareBadge
import com.pathpulse.driver.ui.icons.PpIcons
import com.pathpulse.driver.ui.theme.PathPulseTheme
import com.pathpulse.driver.ui.theme.PpAccentAmber
import com.pathpulse.driver.ui.theme.PpAccentBlue
import com.pathpulse.driver.ui.theme.PpAccentTeal
import com.pathpulse.driver.ui.theme.PpBackground
import com.pathpulse.driver.ui.theme.PpBlack05
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpBlack50
import com.pathpulse.driver.ui.theme.PpBlack70
import com.pathpulse.driver.ui.theme.PpBlue50
import com.pathpulse.driver.ui.theme.PpBlue700
import com.pathpulse.driver.ui.theme.PpRed600
import com.pathpulse.driver.ui.theme.PpSize
import com.pathpulse.driver.ui.theme.PpSpace
import com.pathpulse.driver.ui.theme.PpTeal50
import com.pathpulse.driver.ui.theme.PpTeal700
import com.pathpulse.driver.ui.theme.PpTileShape
import java.util.Locale

private data class Series(val label: String, val pct: String, val color: Color)

private val SERIES = listOf(
    Series("Authorities", "50%", PpAccentBlue),
    Series("Driver rewards", "30%", PpAccentAmber),
    Series("Treasury", "20%", PpAccentTeal),
)

private data class DayBucket(
    val day: String,
    val label: String,
    val values: List<Double>,
    val total: Double,
)

private fun fmt(n: Double) = String.format(Locale.US, "%,.2f", n)

private fun short(a: String) =
    if (a.length <= 12) a else "${a.take(6)}…${a.takeLast(4)}"

private val WEEKDAYS = listOf("Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed")

private fun weekdayLabel(iso: String): String {
    val epochDay = runCatching {
        val y = iso.substring(0, 4).toInt()
        val m = iso.substring(5, 7).toInt()
        val d = iso.substring(8, 10).toInt()
        java.time.LocalDate.of(y, m, d).toEpochDay()
    }.getOrNull() ?: return "—"
    return WEEKDAYS[((epochDay % 7) + 7).toInt() % 7]
}

private fun bucketByDay(batches: List<SettlementBatch>): List<DayBucket> {
    val map = LinkedHashMap<String, DoubleArray>()
    for (b in batches) {
        val day = b.createdAt.take(10)
        val cur = map.getOrPut(day) { DoubleArray(3) }
        cur[0] += b.split.authorities.toDoubleOrNull() ?: 0.0
        cur[1] += b.split.driverRewards.toDoubleOrNull() ?: 0.0
        cur[2] += b.split.treasury.toDoubleOrNull() ?: 0.0
    }
    return map.entries
        .sortedBy { it.key }
        .takeLast(7)
        .map { (day, v) ->
            DayBucket(day, weekdayLabel(day), v.toList(), v.sum())
        }
}

@Composable
fun DashboardScreen(
    batches: List<SettlementBatch>,
    sessions: List<OffRampSession>,
    loading: Boolean,
    error: String?,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var selectedDay by remember { mutableStateOf<Int?>(null) }

    val days = bucketByDay(batches)
    val peak = days.maxOfOrNull { it.total } ?: 0.0
    val totals = DoubleArray(3)
    var gross = 0.0
    for (b in batches) {
        totals[0] += b.split.authorities.toDoubleOrNull() ?: 0.0
        totals[1] += b.split.driverRewards.toDoubleOrNull() ?: 0.0
        totals[2] += b.split.treasury.toDoubleOrNull() ?: 0.0
        gross += b.grossAmount.toDoubleOrNull() ?: 0.0
    }
    val drivers = batches.sumOf { it.driverPayouts.size }

    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PpSize.screenPadding)
            .padding(bottom = PpSpace.xxl),
        verticalArrangement = Arrangement.spacedBy(PpSpace.md),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = PpSpace.sm, bottom = PpSpace.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Dashboard",
                style = MaterialTheme.typography.headlineMedium,
                modifier = Modifier.weight(1f),
            )
            PpSecondaryButton(
                text = if (loading) "Refreshing…" else "Refresh",
                onClick = onRefresh,
                enabled = !loading,
                fillWidth = false,
                icon = PpIcons.Refresh,
            )
        }

        if (error != null) {
            PpCard {
                Text(error, style = MaterialTheme.typography.bodyMedium, color = PpRed600)
            }
        }

        PpCard {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(fmt(gross), style = MaterialTheme.typography.displaySmall)
                Text(
                    " XLM",
                    style = MaterialTheme.typography.titleLarge,
                    color = PpBlack40,
                    modifier = Modifier.padding(bottom = 3.dp),
                )
            }
            Text(
                "Settled across ${batches.size} batch${if (batches.size == 1) "" else "es"}",
                style = MaterialTheme.typography.bodyMedium,
                color = PpBlack50,
                modifier = Modifier.padding(top = PpSpace.xs),
            )

            if (days.isEmpty()) {
                PpEmptyState(
                    title = "No settlement activity yet",
                    message = "Run a settlement batch and this chart fills from on-chain results.",
                )
            } else {
                SettlementChart(
                    days = days,
                    peak = peak,
                    selected = selectedDay,
                    onSelect = { selectedDay = if (selectedDay == it) null else it },
                    modifier = Modifier.padding(top = PpSpace.xl),
                )

                val detail = selectedDay?.let { days.getOrNull(it) }
                if (detail != null) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = PpSpace.lg)
                            .clip(PpTileShape)
                            .background(PpBlack05)
                            .padding(PpSpace.md),
                        verticalArrangement = Arrangement.spacedBy(PpSpace.sm),
                    ) {
                        Text(
                            detail.day,
                            style = MaterialTheme.typography.labelMedium,
                            color = PpBlack50,
                        )
                        SERIES.forEachIndexed { i, s ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                PpLegendSwatch(s.color)
                                Text(
                                    s.label,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = PpBlack70,
                                    modifier = Modifier.padding(start = PpSpace.sm).weight(1f),
                                )
                                Text(fmt(detail.values[i]), style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                } else {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(top = PpSpace.lg),
                        horizontalArrangement = Arrangement.spacedBy(PpSpace.md),
                    ) {
                        SERIES.forEach { s ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                PpLegendSwatch(s.color)
                                Text(
                                    s.label,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = PpBlack50,
                                    modifier = Modifier.padding(start = 6.dp),
                                )
                            }
                        }
                    }
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(PpSpace.md)) {
            StatTile(SERIES[0], totals[0], Modifier.weight(1f))
            StatTile(SERIES[1], totals[1], Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(PpSpace.md)) {
            StatTile(SERIES[2], totals[2], Modifier.weight(1f))
            PpCard(modifier = Modifier.weight(1f), padding = PpSpace.lg) {
                Text(
                    "Driver payouts",
                    style = MaterialTheme.typography.bodySmall,
                    color = PpBlack50,
                )
                Text(
                    drivers.toString(),
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(top = PpSpace.xs),
                )
            }
        }

        PpCard {
            PpCardHeader(
                title = "Split composition",
                subtitle = "Share of all settled volume to date.",
            )
            if (gross == 0.0) {
                Text(
                    "No volume settled yet.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = PpBlack40,
                    modifier = Modifier.padding(top = PpSpace.lg),
                )
            } else {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = PpSpace.lg)
                        .height(12.dp)
                        .clip(RoundedCornerShape(50)),
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    SERIES.forEachIndexed { i, s ->
                        val share = (totals[i] / gross).toFloat()
                        if (share > 0f) {
                            Box(
                                modifier = Modifier
                                    .weight(share)
                                    .fillMaxHeight()
                                    .background(s.color),
                            )
                        }
                    }
                }
                Column(
                    modifier = Modifier.padding(top = PpSpace.lg),
                    verticalArrangement = Arrangement.spacedBy(PpSpace.md),
                ) {
                    SERIES.forEachIndexed { i, s ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            PpLegendSwatch(s.color)
                            Text(
                                s.label,
                                style = MaterialTheme.typography.bodyMedium,
                                color = PpBlack70,
                                modifier = Modifier.padding(start = PpSpace.md).weight(1f),
                            )
                            Text(
                                "${fmt(totals[i])} XLM",
                                style = MaterialTheme.typography.bodySmall,
                                color = PpBlack50,
                            )
                            Text(
                                String.format(Locale.US, "%.1f%%", totals[i] / gross * 100),
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.padding(start = PpSpace.md).width(48.dp),
                                textAlign = androidx.compose.ui.text.style.TextAlign.End,
                            )
                        }
                    }
                }
            }
        }

        PpCard {
            PpCardHeader(title = "Recent activity")
            if (batches.isEmpty() && sessions.isEmpty()) {
                Text(
                    "Nothing settled or withdrawn yet.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = PpBlack40,
                    modifier = Modifier.padding(top = PpSpace.lg),
                )
            } else {
                Column(modifier = Modifier.padding(top = PpSpace.sm)) {
                    batches.take(4).forEachIndexed { i, b ->
                        if (i > 0) PpDivider()
                        ActivityRow(
                            code = "ST",
                            badgeBg = PpBlue50,
                            badgeFg = PpBlue700,
                            title = "Settlement batch",
                            subtitle = short(b.txHash),
                            monospaceSubtitle = true,
                            amount = "${fmt(b.grossAmount.toDoubleOrNull() ?: 0.0)} XLM",
                            date = b.createdAt.take(10),
                        )
                    }
                    sessions.take(4).forEachIndexed { i, s ->
                        if (batches.isNotEmpty() || i > 0) PpDivider()
                        ActivityRow(
                            code = "OR",
                            badgeBg = PpTeal50,
                            badgeFg = PpTeal700,
                            title = "Off-ramp · ${s.fiatCurrency}",
                            subtitle = s.status.replace('_', ' '),
                            monospaceSubtitle = false,
                            amount = "${fmt(s.amount.toDoubleOrNull() ?: 0.0)} ${s.asset.code}",
                            date = s.createdAt.take(10),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun StatTile(series: Series, value: Double, modifier: Modifier = Modifier) {
    PpCard(modifier = modifier, padding = PpSpace.lg) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            PpLegendSwatch(series.color)
            Text(
                series.pct,
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack50,
                modifier = Modifier.padding(start = 6.dp),
            )
        }
        Text(
            series.label,
            style = MaterialTheme.typography.bodySmall,
            color = PpBlack50,
            modifier = Modifier.padding(top = 2.dp),
        )
        Text(
            fmt(value),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(top = PpSpace.xs),
        )
    }
}

@Composable
private fun SettlementChart(
    days: List<DayBucket>,
    peak: Double,
    selected: Int?,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth().height(PpSize.chartHeight),
        horizontalArrangement = Arrangement.spacedBy(PpSpace.sm),
        verticalAlignment = Alignment.Bottom,
    ) {
        days.forEachIndexed { i, d ->
            val dimmed = selected != null && selected != i
            Column(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = { onSelect(i) },
                    ),
                verticalArrangement = Arrangement.Bottom,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                val fraction = if (peak > 0) (d.total / peak).toFloat().coerceIn(0.02f, 1f) else 0.02f
                Box(
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    contentAlignment = Alignment.BottomCenter,
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .fillMaxHeight(fraction)
                            .clip(RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp)),
                        verticalArrangement = Arrangement.Bottom,
                    ) {
                        SERIES.forEachIndexed { si, s ->
                            val v = d.values[si].toFloat()
                            if (v > 0f) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .weight(v)
                                        .background(s.color.copy(alpha = if (dimmed) 0.4f else 1f)),
                                )
                            }
                        }
                    }
                }
                Text(
                    d.label,
                    style = MaterialTheme.typography.bodySmall,
                    color = if (selected == i) PpBlack70 else PpBlack40,
                    modifier = Modifier.padding(top = PpSpace.sm),
                )
            }
        }
    }
}

@Composable
private fun ActivityRow(
    code: String,
    badgeBg: Color,
    badgeFg: Color,
    title: String,
    subtitle: String,
    monospaceSubtitle: Boolean,
    amount: String,
    date: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = PpSpace.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PpSquareBadge(text = code, background = badgeBg, contentColor = badgeFg)
        Column(modifier = Modifier.padding(start = PpSpace.md).weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack40,
                fontFamily = if (monospaceSubtitle) FontFamily.Monospace else null,
                maxLines = 1,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            Text(amount, style = MaterialTheme.typography.bodyMedium)
            Text(
                date,
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack40,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

private fun sampleBatches(): List<SettlementBatch> {
    val amounts = listOf(820.0, 1340.0, 610.0, 1980.0, 1105.0, 2410.0, 1520.0)
    return amounts.mapIndexed { i, gross ->
        SettlementBatch(
            id = "batch_$i",
            createdAt = "2026-08-%02dT10:00:00Z".format(i + 6),
            network = "testnet",
            grossAmount = gross.toString(),
            asset = com.pathpulse.driver.network.AssetRef(code = "XLM"),
            split = com.pathpulse.driver.network.SettlementSplit(
                authorities = (gross * 0.5).toString(),
                driverRewards = (gross * 0.3).toString(),
                treasury = (gross * 0.2).toString(),
            ),
            driverPayouts = emptyList(),
            txHash = "3a91f2c7de0b45188ac2f5e1b7d9042c6f18ab3e",
        )
    }
}

private fun sampleSessions(): List<OffRampSession> = listOf(
    OffRampSession(
        id = "or_1",
        provider = "mercuryo",
        status = "pending_anchor",
        amount = "420.00",
        asset = com.pathpulse.driver.network.AssetRef(code = "USDC"),
        fiatCurrency = "EUR",
        createdAt = "2026-08-12T09:12:00Z",
    ),
)

@Preview(showBackground = true, backgroundColor = 0xFFF5F5F5, heightDp = 1400)
@Composable
private fun DashboardScreenPreview() {
    PathPulseTheme {
        Box(modifier = Modifier.background(PpBackground)) {
            DashboardScreen(
                batches = sampleBatches(),
                sessions = sampleSessions(),
                loading = false,
                error = null,
                onRefresh = {},
            )
        }
    }
}

@Preview(showBackground = true, backgroundColor = 0xFFF5F5F5, name = "Empty")
@Composable
private fun DashboardScreenEmptyPreview() {
    PathPulseTheme {
        Box(modifier = Modifier.background(PpBackground)) {
            DashboardScreen(
                batches = emptyList(),
                sessions = emptyList(),
                loading = false,
                error = null,
                onRefresh = {},
            )
        }
    }
}
