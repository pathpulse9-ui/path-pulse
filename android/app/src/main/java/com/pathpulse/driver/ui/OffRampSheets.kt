package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.pathpulse.driver.network.ApiException
import com.pathpulse.driver.network.CarretBank
import com.pathpulse.driver.network.CarretLimits
import com.pathpulse.driver.network.DataRepository
import com.pathpulse.driver.network.OffRampQuote
import com.pathpulse.driver.network.OffRampSession
import com.pathpulse.driver.network.RegisterCarretBankRequest
import com.pathpulse.driver.network.SettlementBatch
import com.pathpulse.driver.network.UserErrors
import com.pathpulse.driver.ui.components.PpCard
import com.pathpulse.driver.ui.components.PpPrimaryButton
import com.pathpulse.driver.ui.theme.PpBlack15
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpBlack70
import com.pathpulse.driver.ui.theme.PpMint
import com.pathpulse.driver.ui.theme.PpRed600
import com.pathpulse.driver.ui.theme.PpSize
import com.pathpulse.driver.ui.theme.PpSpace
import com.pathpulse.driver.ui.theme.PpSurface
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.IOException
import java.util.UUID

private val ACCOUNT_NO = Regex("^\\d{9,18}$")
private val IFSC = Regex("^[A-Z]{4}0[A-Z0-9]{6}$")
private val AMOUNT = Regex("^\\d+(\\.\\d{1,7})?$")
private val RETRYABLE_ERRORS = setOf("IdempotencyInProgress", "IdempotencyUnavailable")
private val TERMINAL_STATUSES = setOf("completed", "error", "refunded", "filled", "partially_filled", "cancelled", "partially_cancelled")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BankRegistrationSheet(
    dataRepository: DataRepository,
    onDismiss: () -> Unit,
    onRegistered: (CarretBank) -> Unit,
) {
    var accountNo by remember { mutableStateOf("") }
    var ifsc by remember { mutableStateOf("") }
    var holder by remember { mutableStateOf("") }
    var bankName by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    val accountValid = ACCOUNT_NO.matches(accountNo)
    val ifscValid = IFSC.matches(ifsc)
    val canSubmit = accountValid && ifscValid && holder.isNotBlank() && bankName.isNotBlank() && !submitting

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = PpSurface,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        SheetColumn {
            Text("Add your bank", style = MaterialTheme.typography.titleLarge)
            Text(
                "INR from your withdrawals lands here. Carret verifies ownership with a ₹1 penny-drop — usually clears in under a minute.",
                style = MaterialTheme.typography.bodySmall,
                color = PpBlack70,
            )
            error?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = PpRed600) }
            SheetField(
                label = "Account number",
                value = accountNo,
                onChange = { accountNo = it.filter(Char::isDigit) },
                placeholder = "e.g. 33611990000004",
                hint = if (accountNo.isNotEmpty() && !accountValid) "9–18 digits" else null,
                keyboard = KeyboardType.Number,
            )
            SheetField(
                label = "IFSC",
                value = ifsc,
                onChange = { ifsc = it.uppercase().take(11) },
                placeholder = "e.g. HDFC0001234",
                hint = if (ifsc.isNotEmpty() && !ifscValid) "11 characters, e.g. HDFC0001234" else null,
                capitalization = KeyboardCapitalization.Characters,
            )
            SheetField(
                label = "Account holder name (as in passbook)",
                value = holder,
                onChange = { holder = it },
                placeholder = "e.g. AADITYA SINGH",
                capitalization = KeyboardCapitalization.Characters,
            )
            SheetField(
                label = "Bank name",
                value = bankName,
                onChange = { bankName = it },
                placeholder = "e.g. HDFC Bank",
                capitalization = KeyboardCapitalization.Words,
            )
            PpPrimaryButton(
                text = if (submitting) "Verifying…" else "Add bank",
                enabled = canSubmit,
                onClick = {
                    submitting = true
                    error = null
                    scope.launch {
                        try {
                            val bank = dataRepository.registerCarretBank(
                                RegisterCarretBankRequest(
                                    bank_account_no = accountNo,
                                    bank_ifsc = ifsc,
                                    bank_account_name = holder.trim(),
                                    bank_name = bankName.trim(),
                                ),
                            )
                            onRegistered(bank)
                            onDismiss()
                        } catch (e: Exception) {
                            error = UserErrors.message(e)
                        } finally {
                            submitting = false
                        }
                    }
                },
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WithdrawSheet(
    dataRepository: DataRepository,
    limits: CarretLimits?,
    onDismiss: () -> Unit,
) {
    var amount by remember { mutableStateOf("") }
    var quote by remember { mutableStateOf<OffRampQuote?>(null) }
    var quoting by remember { mutableStateOf(false) }
    var placing by remember { mutableStateOf(false) }
    var placed by remember { mutableStateOf<OffRampSession?>(null) }
    var pending by remember { mutableStateOf<Pair<String, String>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var batches by remember { mutableStateOf<List<SettlementBatch>?>(null) }
    var selectedBatchId by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        if (batches == null) {
            runCatching { dataRepository.settlementBatches(10) }.getOrNull()?.let { page ->
                batches = page.items
                if (selectedBatchId == null) selectedBatchId = page.items.firstOrNull()?.id
            }
        }
    }

    LaunchedEffect(amount) {
        quote = null
        if (!AMOUNT.matches(amount) || amount.toDouble() <= 0.0) {
            quoting = false
            return@LaunchedEffect
        }
        quoting = true
        delay(350)
        try {
            quote = dataRepository.offRampQuote(amount)
            error = null
        } catch (e: Exception) {
            error = UserErrors.message(e)
        } finally {
            quoting = false
        }
    }

    val session = placed
    LaunchedEffect(session?.id) {
        val id = session?.id ?: return@LaunchedEffect
        while (placed?.status?.lowercase() !in TERMINAL_STATUSES) {
            delay(3_000)
            runCatching { dataRepository.offRampSession(id) }.getOrNull()?.let { placed = it }
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = PpSurface,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        SheetColumn {
            if (session != null) {
                WithdrawalResult(session)
                PpPrimaryButton(text = "Done", onClick = onDismiss)
            } else {
                Text("New withdrawal", style = MaterialTheme.typography.titleLarge)
                error?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = PpRed600) }
                SheetField(
                    label = "Amount (USDC)",
                    value = amount,
                    onChange = { amount = sanitizeAmount(it) },
                    placeholder = "0",
                    keyboard = KeyboardType.Decimal,
                )

                SettlementBatchPicker(
                    batches = batches,
                    selectedId = selectedBatchId,
                    onPick = { selectedBatchId = it },
                )

                if (quoting) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(modifier = Modifier.padding(end = PpSpace.sm).size(18.dp), color = PpMint, strokeWidth = 2.dp)
                        Text("Fetching rate…", style = MaterialTheme.typography.bodySmall, color = PpBlack40)
                    }
                }
                quote?.let { QuotePreview(it) }
                limits?.let {
                    Text(
                        "Daily limit: ₹${it.remaining.withdraw_inr.toInt()} remaining of ₹${it.dailyCapInr.toInt()}.",
                        style = MaterialTheme.typography.bodySmall,
                        color = PpBlack40,
                    )
                }
                PpPrimaryButton(
                    text = if (placing) "Placing…" else "Confirm withdrawal",
                    enabled = quote != null && !quoting && !placing && selectedBatchId != null,
                    onClick = {
                        val batchId = selectedBatchId ?: return@PpPrimaryButton
                        if (pending?.first != amount) pending = amount to UUID.randomUUID().toString()
                        val key = pending!!.second
                        placing = true
                        error = null
                        scope.launch {
                            try {
                                placed = dataRepository.createOffRampSession(amount, batchId, key)
                                pending = null
                            } catch (e: Exception) {
                                if (!isRetryable(e)) pending = null
                                error = UserErrors.message(e)
                            } finally {
                                placing = false
                            }
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun QuotePreview(q: OffRampQuote) {
    PpCard {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("You receive", style = MaterialTheme.typography.labelMedium, color = PpBlack70, modifier = Modifier.weight(1f))
            Text("₹${q.fiatAmount}", style = MaterialTheme.typography.headlineSmall)
        }
        SheetLine("Rate", "₹${q.rate} / ${q.asset}")
        q.fees.forEach { f -> SheetLine(f.label, "${if (f.currency == "INR") "₹" else ""}${f.amount}") }
        Text(
            if (q.live) "Live quote from ${q.provider.replaceFirstChar { it.uppercase() }} · valid 10 min"
            else "Indicative rate — final rate locked at confirm",
            style = MaterialTheme.typography.bodySmall,
            color = PpBlack40,
            modifier = Modifier.padding(top = PpSpace.sm),
        )
    }
}

@Composable
private fun WithdrawalResult(s: OffRampSession) {
    val status = s.status.lowercase()
    val (title, subtitle) = when (status) {
        "filled", "completed" -> "Payout in your bank" to "${s.amount} ${s.asset.code} → ${s.fiatCurrency} landed."
        "partially_filled" -> "Partially filled" to "Some of your ${s.asset.code} converted. The remainder is refunded."
        "cancelled", "partially_cancelled", "error" ->
            "Withdrawal didn't complete" to "Carret cancelled the order. Any blocked funds are released back to your account."
        else -> "Withdrawal placed" to "${s.amount} ${s.asset.code} → ${s.fiatCurrency}. Waiting for Carret to fill your order."
    }
    Text(title, style = MaterialTheme.typography.titleLarge)
    Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = PpBlack70)
    Text(s.status.replace('_', ' '), style = MaterialTheme.typography.labelMedium, color = PpBlack40)
}

@Composable
private fun SheetLine(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth().padding(top = PpSpace.xs)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = PpBlack40, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodySmall, color = PpBlack70)
    }
}

@Composable
private fun SheetColumn(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PpSize.screenPadding)
            .padding(bottom = PpSpace.lg)
            .windowInsetsPadding(WindowInsets.navigationBars)
            .imePadding(),
        verticalArrangement = Arrangement.spacedBy(PpSpace.md),
    ) { content() }
}

@Composable
private fun SheetField(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    hint: String? = null,
    keyboard: KeyboardType = KeyboardType.Text,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
) {
    Column {
        Text(label, style = MaterialTheme.typography.labelSmall, color = PpBlack40, modifier = Modifier.padding(bottom = PpSpace.xs))
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            placeholder = { Text(placeholder, color = PpBlack40) },
            shape = RoundedCornerShape(14.dp),
            keyboardOptions = KeyboardOptions(keyboardType = keyboard, capitalization = capitalization),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = PpSurface,
                unfocusedContainerColor = PpSurface,
                focusedIndicatorColor = PpMint,
                unfocusedIndicatorColor = PpBlack15,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        hint?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = PpRed600, modifier = Modifier.padding(top = PpSpace.xs)) }
    }
}

@Composable
private fun SettlementBatchPicker(
    batches: List<SettlementBatch>?,
    selectedId: String?,
    onPick: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Column {
        Text(
            "Settlement batch",
            style = MaterialTheme.typography.labelSmall,
            color = PpBlack40,
            modifier = Modifier.padding(bottom = PpSpace.xs),
        )
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .border(1.dp, PpBlack15, RoundedCornerShape(14.dp))
                .background(PpSurface)
                .clickable { open = true }
                .padding(PpSpace.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                selectedId ?: when {
                    batches == null -> "Loading recent batches…"
                    batches.isEmpty() -> "No settlement batches yet"
                    else -> "Pick a settlement batch…"
                },
                color = if (selectedId == null) PpBlack40 else PpBlack70,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            Text("▾", color = PpBlack40)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            batches.orEmpty().forEach { b ->
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(b.id, style = MaterialTheme.typography.bodySmall)
                            Text(
                                "${b.grossAmount} ${b.asset.code} · ${b.createdAt.take(10)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = PpBlack40,
                            )
                        }
                    },
                    onClick = { onPick(b.id); open = false },
                )
            }
        }
        Text(
            "Required — binds this withdrawal to the on-chain settlement batch it draws from.",
            style = MaterialTheme.typography.bodySmall,
            color = PpBlack40,
            modifier = Modifier.padding(top = PpSpace.xs),
        )
    }
}

private fun sanitizeAmount(raw: String): String {
    val digits = raw.filter { it.isDigit() || it == '.' }
    val dot = digits.indexOf('.')
    if (dot < 0) return digits
    return digits.substring(0, dot + 1) + digits.substring(dot + 1).filter(Char::isDigit).take(7)
}

private fun isRetryable(e: Exception): Boolean =
    e is IOException || (e is ApiException && e.apiError.error in RETRYABLE_ERRORS)
