package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.Refresh
import com.pathpulse.driver.network.DataRepository
import com.pathpulse.driver.network.OffRampSession
import com.pathpulse.driver.network.OffRampStatusEvent
import com.pathpulse.driver.network.OnRampSession
import com.pathpulse.driver.ui.components.PpCard
import com.pathpulse.driver.ui.components.PpDivider
import com.pathpulse.driver.ui.theme.PpAccentAmber
import com.pathpulse.driver.ui.theme.PpBlack05
import com.pathpulse.driver.ui.theme.PpBlack15
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpBlack70
import com.pathpulse.driver.ui.theme.PpBlue100
import com.pathpulse.driver.ui.theme.PpBlue700
import com.pathpulse.driver.ui.theme.PpGreen100
import com.pathpulse.driver.ui.theme.PpGreen500
import com.pathpulse.driver.ui.theme.PpGreen700
import com.pathpulse.driver.ui.theme.PpMint26
import com.pathpulse.driver.ui.theme.PpMintInk
import com.pathpulse.driver.ui.theme.PpPillShape
import com.pathpulse.driver.ui.theme.PpRed500
import com.pathpulse.driver.ui.theme.PpRed600
import com.pathpulse.driver.ui.theme.PpSize
import com.pathpulse.driver.ui.theme.PpSpace
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/**
 * Driver activity history. Chronological list of every off-ramp + on-ramp
 * session, filterable by direction + status. Tapping a row expands the
 * per-session status-event log (off-ramp) or a snapshot (on-ramp).
 *
 * Presented as a full-screen ModalBottomSheet from the Off-ramp tab so it
 * fits within the 5-tab shell.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HistoryScreen(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    dataRepository: DataRepository = remember { DataRepository() },
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        HistoryContent(dataRepository = dataRepository, modifier = modifier)
    }
}

private enum class Direction(val label: String) { All("All"), Off("Off-ramp"), On("On-ramp") }

private enum class StatusFilter(val label: String, val matches: Set<String>) {
    All("All statuses", emptySet()),
    AwaitingTransfer("Awaiting transfer", setOf("pending_user_transfer_start")),
    Converting("Converting", setOf("pending_anchor")),
    Completed("Completed", setOf("completed")),
    Filled("Filled", setOf("filled")),
    PartiallyFilled("Partially filled", setOf("partially_filled")),
    Cancelled("Cancelled", setOf("cancelled", "partially_cancelled")),
    Error("Error", setOf("error")),
}

private data class HistoryRow(
    val id: String,
    val direction: Direction,
    val status: String,
    val amount: String,
    val asset: String,
    val fiatCurrency: String,
    val fiatAmount: String?,
    val settlementBatchId: String?,
    val createdAt: String,
)

@Composable
private fun HistoryContent(
    dataRepository: DataRepository,
    modifier: Modifier = Modifier,
) {
    var off by remember { mutableStateOf<List<OffRampSession>?>(null) }
    var on by remember { mutableStateOf<List<OnRampSession>?>(null) }
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var direction by remember { mutableStateOf(Direction.All) }
    var statusFilter by remember { mutableStateOf(StatusFilter.All) }
    var expandedKey by remember { mutableStateOf<String?>(null) }
    var reloadKey by remember { mutableStateOf(0) }

    LaunchedEffect(reloadKey) {
        loading = true
        errorMsg = null
        off = runCatching { dataRepository.offRampSessions(200) }.getOrNull()?.items
        on  = runCatching { dataRepository.onRampSessions(200) }.getOrNull()?.items
        loading = false
    }

    val rows = buildList {
        off?.forEach {
            add(HistoryRow(
                id = it.id, direction = Direction.Off, status = it.status,
                amount = it.amount, asset = it.asset.code,
                fiatCurrency = it.fiatCurrency,
                fiatAmount = it.fiatAmountEstimate,
                settlementBatchId = it.settlementBatchId,
                createdAt = it.createdAt,
            ))
        }
        on?.forEach {
            add(HistoryRow(
                id = it.id, direction = Direction.On, status = it.status,
                amount = it.amount, asset = "INR",
                fiatCurrency = it.asset,
                fiatAmount = it.cryptoAmount,
                settlementBatchId = null,
                createdAt = it.createdAt,
            ))
        }
    }.sortedByDescending { it.createdAt }

    val filtered = rows.filter { r ->
        if (direction != Direction.All && r.direction != direction) return@filter false
        if (statusFilter != StatusFilter.All &&
            r.status.lowercase() !in statusFilter.matches) return@filter false
        true
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PpSize.screenPadding)
            .padding(bottom = PpSpace.xxl),
        verticalArrangement = Arrangement.spacedBy(PpSpace.md),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text("History", style = MaterialTheme.typography.titleLarge)
                Text(
                    "Every off-ramp and on-ramp session, newest first.",
                    style = MaterialTheme.typography.bodySmall,
                    color = PpBlack70,
                )
            }
            IconButton(onClick = { reloadKey++ }, enabled = !loading) {
                Icon(Icons.Outlined.Refresh, contentDescription = "Refresh")
            }
        }

        FilterStrip(
            direction = direction, onDirection = { direction = it },
            statusFilter = statusFilter, onStatus = { statusFilter = it },
        )

        if (errorMsg != null) {
            PpCard { Text(errorMsg!!, color = PpRed600, style = MaterialTheme.typography.bodyMedium) }
        }

        when {
            loading && rows.isEmpty() -> PpCard { Text("Loading your activity…", color = PpBlack70) }
            filtered.isEmpty() -> PpCard { Text("No activity in this filter.", color = PpBlack70) }
            else -> PpCard {
                Column {
                    filtered.forEachIndexed { i, r ->
                        if (i > 0) PpDivider()
                        val key = rowKey(r)
                        HistoryRowView(
                            row = r,
                            expanded = expandedKey == key,
                            onToggle = { expandedKey = if (expandedKey == key) null else key },
                            dataRepository = dataRepository,
                        )
                    }
                }
            }
        }
    }
}

private fun rowKey(r: HistoryRow): String = "${r.direction.name}-${r.id}"

@Composable
private fun FilterStrip(
    direction: Direction,
    onDirection: (Direction) -> Unit,
    statusFilter: StatusFilter,
    onStatus: (StatusFilter) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(PpSpace.sm)) {
        Row(horizontalArrangement = Arrangement.spacedBy(PpSpace.xs)) {
            Direction.entries.forEach { d ->
                val selected = direction == d
                Box(
                    modifier = Modifier
                        .clip(PpPillShape)
                        .background(if (selected) Color.Black else Color.Transparent)
                        .clickable { onDirection(d) }
                        .padding(horizontal = PpSpace.md, vertical = 6.dp),
                ) {
                    Text(
                        d.label,
                        style = MaterialTheme.typography.labelSmall,
                        color = if (selected) Color.White else PpBlack70,
                    )
                }
            }
        }
        StatusDropdown(statusFilter, onStatus)
    }
}

@Composable
private fun StatusDropdown(selected: StatusFilter, onSelect: (StatusFilter) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }) {
            Text("Status: ${selected.label}", style = MaterialTheme.typography.labelMedium)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            StatusFilter.entries.forEach { s ->
                DropdownMenuItem(
                    text = { Text(s.label) },
                    onClick = { onSelect(s); open = false },
                )
            }
        }
    }
}

@Composable
private fun HistoryRowView(
    row: HistoryRow,
    expanded: Boolean,
    onToggle: () -> Unit,
    dataRepository: DataRepository,
) {
    Column(
        modifier = Modifier.fillMaxWidth().clickable { onToggle() }.padding(vertical = PpSpace.sm),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            DirectionBadge(row.direction)
            Spacer(Modifier.width(PpSpace.md))
            Column(modifier = Modifier.weight(1f)) {
                Text("${row.amount} ${row.asset}", style = MaterialTheme.typography.bodyMedium)
                row.fiatAmount?.let {
                    Text(
                        "${if (row.direction == Direction.Off) "→" else "="} $it ${row.fiatCurrency}",
                        style = MaterialTheme.typography.bodySmall,
                        color = PpBlack40,
                    )
                }
                Text(
                    formatDate(row.createdAt),
                    style = MaterialTheme.typography.labelSmall,
                    color = PpBlack40,
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                StatusChip(row.status)
                row.settlementBatchId?.let {
                    Text(
                        "↳ ${shorten(it)}",
                        style = MaterialTheme.typography.labelSmall,
                        color = PpBlack40,
                    )
                }
            }
            Spacer(Modifier.width(PpSpace.sm))
            Icon(
                imageVector = if (expanded) Icons.Outlined.KeyboardArrowUp else Icons.Outlined.KeyboardArrowDown,
                contentDescription = null,
                tint = PpBlack40,
                modifier = Modifier.size(16.dp),
            )
        }
        if (expanded) {
            Spacer(Modifier.height(PpSpace.sm))
            if (row.direction == Direction.Off) {
                OffRampEventLog(dataRepository, row.id)
            } else {
                OnRampSnapshot(dataRepository, row.id)
            }
        }
    }
}

@Composable
private fun DirectionBadge(d: Direction) {
    val (bg, fg, icon) = when (d) {
        Direction.Off -> Triple(PpBlue100, PpBlue700, Icons.Outlined.ArrowUpward)
        else           -> Triple(PpGreen100, PpGreen700, Icons.Outlined.ArrowDownward)
    }
    Box(
        modifier = Modifier.size(32.dp).clip(CircleShape).background(bg),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(16.dp))
    }
}

@Composable
private fun StatusChip(status: String) {
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

@Composable
private fun OffRampEventLog(dataRepository: DataRepository, sessionId: String) {
    var events by remember { mutableStateOf<List<OffRampStatusEvent>?>(null) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(sessionId) {
        runCatching { dataRepository.offRampSessionEvents(sessionId) }
            .onSuccess { events = it.events }
            .onFailure { errorMsg = it.message ?: "Failed to load event log" }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(PpBlack05)
            .padding(PpSpace.md),
    ) {
        Column {
            when {
                errorMsg != null -> Text(errorMsg!!, color = PpRed600, style = MaterialTheme.typography.bodySmall)
                events == null -> Text("Loading event log…", color = PpBlack40, style = MaterialTheme.typography.bodySmall)
                events!!.isEmpty() -> Text("No events recorded.", color = PpBlack40, style = MaterialTheme.typography.bodySmall)
                else -> {
                    Text(
                        "Status events (${events!!.size}) — append-only, source-tagged",
                        style = MaterialTheme.typography.labelSmall,
                        color = PpBlack40,
                        modifier = Modifier.padding(bottom = PpSpace.xs),
                    )
                    events!!.forEachIndexed { i, e ->
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "${i + 1}.",
                                style = MaterialTheme.typography.labelSmall,
                                color = PpBlack40,
                                modifier = Modifier.width(18.dp),
                            )
                            Box(
                                modifier = Modifier
                                    .clip(PpPillShape)
                                    .background(sourceBg(e.source))
                                    .padding(horizontal = 6.dp, vertical = 2.dp),
                            ) {
                                Text(
                                    e.source,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = sourceInk(e.source),
                                )
                            }
                            Spacer(Modifier.width(PpSpace.sm))
                            Text(
                                e.mappedStatus ?: "(no status change)",
                                style = MaterialTheme.typography.bodySmall,
                                color = PpBlack70,
                            )
                            e.carretStatus?.let {
                                Spacer(Modifier.width(PpSpace.xs))
                                Text("← $it", style = MaterialTheme.typography.bodySmall, color = PpBlack40)
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun sourceBg(s: String): Color = when (s) {
    "placed", "create" -> PpBlack05
    "webhook" -> PpBlue100
    "poll" -> PpAccentAmber.copy(alpha = 0.18f)
    "reconciler" -> PpMint26
    "client" -> PpAccentAmber.copy(alpha = 0.28f)
    else -> PpBlack05
}
private fun sourceInk(s: String): Color = when (s) {
    "webhook" -> PpBlue700
    "reconciler" -> PpMintInk
    else -> PpBlack70
}

@Composable
private fun OnRampSnapshot(dataRepository: DataRepository, sessionId: String) {
    var session by remember { mutableStateOf<OnRampSession?>(null) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(sessionId) {
        runCatching { dataRepository.onRampSession(sessionId) }
            .onSuccess { session = it }
            .onFailure { errorMsg = it.message ?: "Failed to load session" }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(PpBlack05)
            .padding(PpSpace.md),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            when {
                errorMsg != null -> Text(errorMsg!!, color = PpRed600, style = MaterialTheme.typography.bodySmall)
                session == null -> Text("Loading session…", color = PpBlack40, style = MaterialTheme.typography.bodySmall)
                else -> {
                    val s = session!!
                    SnapRow("Order id", s.id)
                    s.bankLast4?.let { SnapRow("Debited from", "••$it") }
                    SnapRow("Status", s.status.replace('_', ' '))
                }
            }
        }
    }
}

@Composable
private fun SnapRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = PpBlack70)
        Spacer(Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodySmall, color = PpBlack70)
    }
}

private val isoFormatter: SimpleDateFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
    .apply { timeZone = TimeZone.getTimeZone("UTC") }
private val displayFormatter: SimpleDateFormat = SimpleDateFormat("MMM d, yyyy · h:mm a", Locale.US)

private fun formatDate(iso: String): String {
    return try {
        val cleaned = iso.substringBefore('.').substringBefore('Z')
        val d = isoFormatter.parse(cleaned) ?: return iso.take(16)
        displayFormatter.format(d)
    } catch (_: Throwable) {
        iso.take(16)
    }
}

private fun shorten(s: String): String =
    if (s.length <= 12) s else "${s.take(6)}…${s.takeLast(4)}"
