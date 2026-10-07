package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import com.pathpulse.driver.network.DataRepository
import com.pathpulse.driver.network.RewardBalance
import com.pathpulse.driver.network.RewardPayout
import com.pathpulse.driver.network.RewardsResponse
import com.pathpulse.driver.network.UserErrors
import com.pathpulse.driver.ui.components.PpCard
import com.pathpulse.driver.ui.components.PpCardHeader
import com.pathpulse.driver.ui.components.PpDivider
import com.pathpulse.driver.ui.components.PpEmptyState
import com.pathpulse.driver.ui.components.PpSecondaryButton
import com.pathpulse.driver.ui.components.PpSquareBadge
import com.pathpulse.driver.ui.theme.PpBackground
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpMint
import com.pathpulse.driver.ui.theme.PpMint26
import com.pathpulse.driver.ui.theme.PpMintInk
import com.pathpulse.driver.ui.theme.PpRed600
import com.pathpulse.driver.ui.theme.PpSize
import com.pathpulse.driver.ui.theme.PpSpace
import com.pathpulse.driver.ui.theme.PpSurface
import kotlinx.coroutines.launch
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun RewardsSection(refreshing: Boolean, dataRepository: DataRepository = remember { DataRepository() }) {
    var rewards by remember { mutableStateOf<RewardsResponse?>(null) }
    var historyOpen by remember { mutableStateOf(false) }

    LaunchedEffect(refreshing) {
        if (!refreshing) rewards = runCatching { dataRepository.rewards(limit = 10) }.getOrNull() ?: rewards
    }

    val current = rewards ?: return
    PpCard {
        PpCardHeader(
            title = "My rewards",
            subtitle = "Balance and payouts received by your wallet.",
            trailing = if (current.items.isNotEmpty()) {
                {
                    Text(
                        "See all",
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.clickable { historyOpen = true }.padding(PpSpace.xs),
                    )
                }
            } else {
                null
            },
        )
        if (current.address == null) {
            PpEmptyState(title = "No wallet yet", message = "Sign in with Google to get a rewards wallet.")
        } else {
            Balances(current.balances)
            if (current.items.isEmpty()) {
                PpEmptyState(title = "No payouts yet", message = "Rewards from settlements appear here.")
            } else {
                current.items.take(3).forEachIndexed { i, p ->
                    if (i > 0) PpDivider()
                    RewardPayoutRow(p)
                }
            }
        }
    }

    if (historyOpen) RewardsHistorySheet(dataRepository, onDismiss = { historyOpen = false })
}

@Composable
private fun Balances(balances: List<RewardBalance>) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = PpSpace.md),
        horizontalArrangement = Arrangement.spacedBy(PpSpace.md),
    ) {
        balances.forEach { b ->
            Column(
                modifier = Modifier
                    .weight(1f)
                    .background(PpBackground, RoundedCornerShape(14.dp))
                    .padding(PpSpace.md),
            ) {
                Text(formatAmount(b.balance), style = MaterialTheme.typography.titleLarge)
                Text(b.asset.code, style = MaterialTheme.typography.labelSmall, color = PpBlack40)
            }
        }
    }
}

@Composable
private fun RewardPayoutRow(payout: RewardPayout) {
    val uriHandler = LocalUriHandler.current
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { uriHandler.openUri(payout.explorerUrl) }
            .padding(vertical = PpSpace.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PpSquareBadge(text = "IN", background = PpMint26, contentColor = PpMintInk)
        Column(modifier = Modifier.padding(start = PpSpace.md).weight(1f)) {
            Text("+${formatAmount(payout.amount)} ${payout.asset.code}", style = MaterialTheme.typography.bodyMedium)
            Text(
                formatDate(payout.createdAt),
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack40,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun RewardsHistorySheet(dataRepository: DataRepository, onDismiss: () -> Unit) {
    val items = remember { mutableStateListOf<RewardPayout>() }
    var nextCursor by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun load() {
        if (loading) return
        loading = true
        error = null
        try {
            val page = dataRepository.rewards(limit = 50, cursor = nextCursor)
            items.addAll(page.items)
            nextCursor = page.nextCursor
        } catch (e: Exception) {
            error = UserErrors.message(e)
        } finally {
            loading = false
        }
    }

    LaunchedEffect(Unit) { load() }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = PpSurface,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        LazyColumn(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = PpSize.screenPadding)
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            item {
                Text(
                    "Payout history",
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(bottom = PpSpace.md),
                )
            }
            error?.let { message ->
                item { Text(message, style = MaterialTheme.typography.bodyMedium, color = PpRed600) }
            }
            if (items.isEmpty() && !loading) {
                item { PpEmptyState(title = "No payouts yet", message = "Rewards from settlements appear here.") }
            }
            itemsIndexed(items, key = { _, p -> p.id }) { i, p ->
                if (i > 0) PpDivider()
                RewardPayoutRow(p)
            }
            item {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = PpSpace.lg),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    when {
                        loading -> CircularProgressIndicator(color = PpMint, strokeWidth = 2.dp)
                        nextCursor != null -> PpSecondaryButton(text = "Load more", onClick = { scope.launch { load() } })
                    }
                }
            }
        }
    }
}

private fun formatAmount(raw: String): String {
    val value = raw.toBigDecimalOrNull() ?: return raw
    return value.setScale(4, java.math.RoundingMode.DOWN).stripTrailingZeros().toPlainString()
}

private val DATE_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm")

private fun formatDate(iso: String): String =
    runCatching { OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(DATE_FORMAT) }.getOrDefault(iso)
