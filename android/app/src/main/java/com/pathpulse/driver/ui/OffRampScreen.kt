package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.pathpulse.driver.network.CarretBank
import com.pathpulse.driver.network.CarretBankRegistrationInput
import com.pathpulse.driver.network.CarretLimits
import com.pathpulse.driver.network.CarretResumeResponse
import com.pathpulse.driver.network.CarretWalletBalance
import com.pathpulse.driver.network.DataRepository
import com.pathpulse.driver.network.OffRampSession
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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
    var resume by remember { mutableStateOf<CarretResumeResponse?>(null) }
    var banks by remember { mutableStateOf<List<CarretBank>?>(null) }
    var wallets by remember { mutableStateOf<List<CarretWalletBalance>?>(null) }
    var showRegisterBank by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        limits = runCatching { dataRepository.carretLimits() }.getOrNull()
        resume = runCatching { dataRepository.resumeCarretKyc() }.getOrNull()
        if (resume?.kycStatus == "verified") {
            banks   = runCatching { dataRepository.listCarretBanks() }.getOrNull()
            wallets = runCatching { dataRepository.carretWallets() }.getOrNull()
        }
    }

    val kycVerified = resume?.kycStatus == "verified"
    val hasVerifiedBank = banks?.any { it.status.equals("verified", true) } == true
    val hasPendingBank  = banks?.any { it.status.equals("pending",  true) } == true
    val usdc = wallets?.firstOrNull { it.asset.uppercase() == "USDC" }
    val usdcAvailable = (usdc?.available ?: usdc?.balance)?.toDoubleOrNull()

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

        if (!kycVerified) {
            // PAT-79: KYC entry banner.
            PpCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Verify your identity", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "A quick one-time check before your first withdrawal.",
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
        } else {
            // Balance chip: "9.00 USDC available".
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
                    hasVerifiedBank.takeIf { it }?.let {
                        banks?.firstOrNull { b -> b.status.equals("verified", true) }?.let { b ->
                            Text(
                                "→ ${b.bank_name} ••${b.last4}",
                                style = MaterialTheme.typography.bodySmall,
                                color = PpBlack70,
                                modifier = Modifier.padding(start = PpSpace.sm),
                            )
                        }
                    }
                }
            }

            // Bank card: empty → CTA; pending → status; verified → list handled below the chip.
            when {
                banks == null -> Unit
                banks!!.isEmpty() -> BankCta(onAdd = { showRegisterBank = true })
                !hasVerifiedBank && hasPendingBank -> PendingBankBanner()
                else -> BanksList(banks = banks!!, onAdd = { showRegisterBank = true })
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
            PpCardHeader(
                title = if (sessions.size == 1) "1 withdrawal" else "${sessions.size} withdrawals",
                subtitle = "Convert your USDC rewards to INR in your bank.",
            )

            if (sessions.isEmpty() && !loading) {
                PpEmptyState(
                    title = "No withdrawals yet",
                    message = "Your withdrawals will appear here.",
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

    // Poll pending banks until the penny-drop clears.
    LaunchedEffect(hasPendingBank, kycVerified) {
        if (!kycVerified) return@LaunchedEffect
        while (hasPendingBank) {
            delay(4_000)
            runCatching { dataRepository.listCarretBanks() }.onSuccess { banks = it }
        }
    }

    if (showRegisterBank) {
        var submitting by remember { mutableStateOf(false) }
        var dialogError by remember { mutableStateOf<String?>(null) }
        BankRegistrationDialog(
            onDismiss = { if (!submitting) showRegisterBank = false },
            submitting = submitting,
            error = dialogError,
            onSubmit = { input ->
                submitting = true; dialogError = null
                scope.launch {
                    runCatching { dataRepository.registerCarretBank(input) }
                        .onSuccess { bank ->
                            banks = (banks ?: emptyList()).filter { it.id != bank.id } + bank
                            showRegisterBank = false
                        }
                        .onFailure { dialogError = it.message ?: "Couldn't register bank" }
                    submitting = false
                }
            },
        )
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

@Composable
private fun BankCta(onAdd: () -> Unit) {
    PpCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Add your bank", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Carret runs a ₹1 penny-drop to verify ownership. Under a minute.",
                    style = MaterialTheme.typography.bodySmall,
                    color = PpBlack70,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            com.pathpulse.driver.ui.components.PpPrimaryButton(
                text = "Add",
                onClick = onAdd,
                fillWidth = false,
                modifier = Modifier.padding(start = PpSpace.md),
            )
        }
    }
}

@Composable
private fun PendingBankBanner() {
    PpCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(PpAccentAmber),
            )
            Spacer(modifier = Modifier.padding(start = PpSpace.sm))
            Text(
                "Verifying your bank with a ₹1 penny-drop — usually under a minute.",
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack70,
            )
        }
    }
}

@Composable
private fun BanksList(banks: List<CarretBank>, onAdd: () -> Unit) {
    PpCard {
        PpCardHeader(
            title = "Payout bank",
            subtitle = if (banks.size == 1) "One bank on file." else "${banks.size} banks on file.",
        )
        Column(modifier = Modifier.padding(top = PpSpace.sm)) {
            banks.forEachIndexed { i, b ->
                if (i > 0) PpDivider()
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = PpSpace.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            "${b.bank_name} ••${b.last4}",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Text(
                            b.bank_ifsc,
                            style = MaterialTheme.typography.bodySmall,
                            color = PpBlack40,
                        )
                    }
                    StatusPill(status = b.status)
                }
            }
            TextButton(onClick = onAdd) {
                Text("Add another bank", style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

@Composable
private fun BankRegistrationDialog(
    onDismiss: () -> Unit,
    onSubmit: (CarretBankRegistrationInput) -> Unit,
    submitting: Boolean,
    error: String?,
) {
    var holder by remember { mutableStateOf("") }
    var bankName by remember { mutableStateOf("") }
    var ifsc by remember { mutableStateOf("") }
    var accountNo by remember { mutableStateOf("") }
    var confirmNo by remember { mutableStateOf("") }

    val ifscValid = Regex("^[A-Z]{4}0[A-Z0-9]{6}$").matches(ifsc)
    val accountValid = Regex("^[0-9]{9,18}$").matches(accountNo)
    val match = accountNo == confirmNo && accountNo.isNotEmpty()
    val canSubmit = !submitting && ifscValid && accountValid && match &&
        holder.isNotBlank() && bankName.isNotBlank()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Register payout bank") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(PpSpace.sm)) {
                Text(
                    "Carret runs a ₹1 penny-drop to prove you own the account.",
                    style = MaterialTheme.typography.bodySmall,
                    color = PpBlack70,
                )
                if (error != null) {
                    Text(error, style = MaterialTheme.typography.bodySmall, color = PpRed600)
                }
                OutlinedTextField(
                    value = holder, onValueChange = { holder = it },
                    label = { Text("Account holder name") },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = bankName, onValueChange = { bankName = it },
                    label = { Text("Bank name") },
                    singleLine = true,
                )
                OutlinedTextField(
                    value = ifsc,
                    onValueChange = { v -> ifsc = v.uppercase().filter { it.isLetterOrDigit() } },
                    label = { Text("IFSC (e.g. HDFC0001234)") },
                    singleLine = true,
                    isError = ifsc.isNotEmpty() && !ifscValid,
                )
                OutlinedTextField(
                    value = accountNo,
                    onValueChange = { v -> accountNo = v.filter { it.isDigit() } },
                    label = { Text("Account number (9-18 digits)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    isError = accountNo.isNotEmpty() && !accountValid,
                )
                OutlinedTextField(
                    value = confirmNo,
                    onValueChange = { v -> confirmNo = v.filter { it.isDigit() } },
                    label = { Text("Re-enter account number") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    isError = confirmNo.isNotEmpty() && !match,
                )
            }
        },
        confirmButton = {
            TextButton(
                enabled = canSubmit,
                onClick = {
                    onSubmit(
                        CarretBankRegistrationInput(
                            bank_account_no  = accountNo,
                            bank_ifsc        = ifsc,
                            bank_account_name = holder.trim(),
                            bank_name        = bankName.trim(),
                        )
                    )
                },
            ) { Text(if (submitting) "Verifying…" else "Register") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        shape = RoundedCornerShape(20.dp),
    )
}

