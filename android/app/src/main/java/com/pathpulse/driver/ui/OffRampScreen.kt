package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontFamily
import com.pathpulse.driver.ui.theme.PpBackground
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
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
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.pathpulse.driver.network.CarretBank
import com.pathpulse.driver.network.CarretLimits
import com.pathpulse.driver.network.CarretWalletBalance
import com.pathpulse.driver.network.DataRepository
import com.pathpulse.driver.network.OffRampSession
import kotlinx.coroutines.delay
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
    var kycStatus by remember { mutableStateOf<String?>(null) }
    var banks by remember { mutableStateOf<List<CarretBank>?>(null) }
    var wallets by remember { mutableStateOf<List<CarretWalletBalance>?>(null) }
    var bankSheetOpen by remember { mutableStateOf(false) }
    var withdrawSheetOpen by remember { mutableStateOf(false) }
    var historySheetOpen by remember { mutableStateOf(false) }
    var receipt by remember { mutableStateOf<OffRampSession?>(null) }
    var reloadKey by remember { mutableIntStateOf(0) }

    LaunchedEffect(reloadKey) {
        limits = runCatching { dataRepository.carretLimits() }.getOrNull()
        kycStatus = runCatching { dataRepository.resumeCarretKyc() }.getOrNull()?.kycStatus
        if (kycStatus == "verified") {
            banks   = runCatching { dataRepository.carretBanks() }.getOrDefault(emptyList())
            wallets = runCatching { dataRepository.carretWallets() }.getOrNull()
        } else {
            banks = null
            wallets = null
        }
    }

    val kycVerified = kycStatus == "verified"
    val verifiedBank = banks?.firstOrNull { it.isVerified }
    val hasPendingBank = banks?.any { it.status.equals("pending", true) } == true
    val usdc = wallets?.firstOrNull { it.asset.uppercase() == "USDC" }
    val usdcAvailable = (usdc?.available ?: usdc?.balance)?.toDoubleOrNull()

    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PpSize.screenPadding)
            .padding(bottom = PpSpace.xxl),
        verticalArrangement = Arrangement.spacedBy(PpSpace.md),
    ) {
        PpTabHeader(
            title = "Off-ramp",
            loading = loading,
            onRefresh = {
                reloadKey++
                onRefresh()
            },
        )

        if (error != null) {
            PpCard {
                Text(error, style = MaterialTheme.typography.bodyMedium, color = PpRed600)
            }
        }

        when {
            !kycVerified -> ActionBanner(
                title = "Verify your identity",
                subtitle = "A quick one-time check before your first withdrawal.",
                action = if (kycStatus == "rejected" || kycStatus == "re_kyc") "Retry" else "Start",
                enabled = kycStatus != "manual_review",
                onAction = onOpenKyc,
            )
            verifiedBank != null -> ActionBanner(
                title = "You're verified",
                subtitle = "${verifiedBank.bank_name} · ${verifiedBank.bank_ifsc} · ${verifiedBank.maskedAccount}",
                action = "New withdrawal",
                onAction = { withdrawSheetOpen = true },
            )
            banks?.isEmpty() == true -> ActionBanner(
                title = "Add your bank",
                subtitle = "INR from your withdrawals is paid to this account.",
                action = "Add bank",
                onAction = { bankSheetOpen = true },
            )
            banks != null -> ActionBanner(
                title = "Bank pending verification",
                subtitle = "Carret is running a ₹1 penny-drop. Usually clears within a minute.",
                action = "Check again",
                onAction = { reloadKey++ },
            )
        }

        // Balance chip once the trading wallet has a USDC entry.
        usdcAvailable?.let { bal ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .clip(PpPillShape)
                        .background(PpMint26)
                        .padding(horizontal = PpSpace.md, vertical = 4.dp),
                ) {
                    Text(
                        "%.2f USDC available".format(bal),
                        style = MaterialTheme.typography.labelSmall,
                        color = PpMintInk,
                    )
                }
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
                    "of ₹${l.dailyCapInr.toInt()} daily limit",
                    style = MaterialTheme.typography.bodySmall,
                    color = PpBlack40,
                    modifier = Modifier.padding(start = PpSpace.sm),
                )
            }
        }

        PpCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        if (sessions.size == 1) "1 withdrawal" else "${sessions.size} withdrawals",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        "Convert your USDC rewards to INR in your bank.",
                        style = MaterialTheme.typography.bodySmall,
                        color = PpBlack70,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
                TextButton(onClick = { historySheetOpen = true }) {
                    Text("History", style = MaterialTheme.typography.labelMedium)
                }
            }

            if (sessions.isEmpty() && !loading) {
                PpEmptyState(
                    title = "No withdrawals yet",
                    message = when {
                        !kycVerified -> "Verify your identity to start withdrawing."
                        verifiedBank == null -> "Add a verified bank to start withdrawing."
                        else -> "Tap New withdrawal to send your first payout."
                    },
                )
            } else {
                Column(modifier = Modifier.padding(top = PpSpace.sm)) {
                    sessions.forEachIndexed { i, s ->
                        if (i > 0) PpDivider()
                        OffRampRow(session = s, onClick = { receipt = s })
                    }
                }
            }
        }
    }

    // Poll pending banks until the penny-drop clears.
    LaunchedEffect(hasPendingBank, kycVerified) {
        if (!kycVerified) return@LaunchedEffect
        while (hasPendingBank) {
            delay(4_000)
            runCatching { dataRepository.carretBanks() }.onSuccess { banks = it }
        }
    }

    if (bankSheetOpen) {
        BankRegistrationSheet(
            dataRepository = dataRepository,
            onDismiss = {
                bankSheetOpen = false
                reloadKey++
            },
            onRegistered = { bank -> banks = banks.orEmpty() + bank },
        )
    }

    if (historySheetOpen) {
        HistoryScreen(
            onDismiss = { historySheetOpen = false },
            dataRepository = dataRepository,
        )
    }

    receipt?.let { WithdrawalReceiptSheet(session = it, onDismiss = { receipt = null }) }

    if (withdrawSheetOpen) {
        WithdrawSheet(
            dataRepository = dataRepository,
            limits = limits,
            onDismiss = {
                withdrawSheetOpen = false
                reloadKey++
                onRefresh()
            },
        )
    }
}

@Composable
private fun ActionBanner(
    title: String,
    subtitle: String,
    action: String,
    onAction: () -> Unit,
    enabled: Boolean = true,
) {
    PpCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = PpBlack70,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            com.pathpulse.driver.ui.components.PpPrimaryButton(
                text = action,
                onClick = onAction,
                enabled = enabled,
                fillWidth = false,
                modifier = Modifier.padding(start = PpSpace.md),
            )
        }
    }
}

@Composable
private fun OffRampRow(session: OffRampSession, onClick: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = PpSpace.md),
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
        Icon(
            Icons.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = PpBlack40,
            modifier = Modifier.padding(start = PpSpace.sm).size(20.dp),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WithdrawalReceiptSheet(session: OffRampSession, onDismiss: () -> Unit) {
    val uriHandler = LocalUriHandler.current
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = PpBackground,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = PpSize.screenPadding)
                .padding(bottom = PpSpace.xl)
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            Text("Withdrawal receipt", style = MaterialTheme.typography.labelLarge, color = PpBlack40)
            Text(
                "${session.amount} ${session.asset.code}",
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.padding(top = PpSpace.sm),
            )
            session.fiatAmountEstimate?.let {
                Text(
                    "≈ $it ${session.fiatCurrency} to your bank",
                    style = MaterialTheme.typography.bodyMedium,
                    color = PpBlack70,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            Box(modifier = Modifier.padding(top = PpSpace.sm)) { StatusPill(status = session.status) }

            PpCard(modifier = Modifier.padding(top = PpSpace.lg)) {
                ReceiptRow("Provider", session.provider.replaceFirstChar { it.uppercase() })
                session.merchantTransactionId?.let { PpDivider(); ReceiptRow("Order", "#$it", mono = true) }
                session.settlementBatchId?.let { PpDivider(); ReceiptRow("Settlement batch", it, mono = true) }
                PpDivider()
                ReceiptRow("Requested", receiptDate(session.createdAt))
                session.updatedAt?.let { PpDivider(); ReceiptRow("Last update", receiptDate(it)) }
                PpDivider()
                ReceiptRow("Reference", session.id, mono = true)
            }

            PpCard(modifier = Modifier.padding(top = PpSpace.md)) {
                Text("Stellar transfer", style = MaterialTheme.typography.titleSmall)
                val hash = session.stellarTxHash
                val url = session.stellarTxUrl
                if (hash != null && url != null) {
                    Text(
                        "${hash.take(10)}…${hash.takeLast(8)}  ↗",
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        color = PpTeal700,
                        modifier = Modifier
                            .padding(top = PpSpace.sm)
                            .clickable { uriHandler.openUri(url) },
                    )
                } else {
                    Text(
                        if (session.sandbox == true) {
                            "Sandbox withdrawal — nothing was sent on the Stellar network."
                        } else {
                            "No Stellar transfer is recorded for this withdrawal yet."
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = PpBlack70,
                        modifier = Modifier.padding(top = PpSpace.sm),
                    )
                }
            }
        }
    }
}

@Composable
private fun ReceiptRow(label: String, value: String, mono: Boolean = false) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = PpSpace.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = PpBlack40)
        Text(
            value,
            style = if (mono) {
                MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace)
            } else {
                MaterialTheme.typography.bodyMedium
            },
            textAlign = androidx.compose.ui.text.style.TextAlign.End,
            modifier = Modifier.weight(1f).padding(start = PpSpace.md),
        )
    }
}

private val RECEIPT_DATE: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM yyyy, HH:mm")

private fun receiptDate(iso: String): String =
    runCatching { OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).format(RECEIPT_DATE) }.getOrDefault(iso)

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

