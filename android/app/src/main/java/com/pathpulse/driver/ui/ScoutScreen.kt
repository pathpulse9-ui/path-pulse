package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.pathpulse.driver.network.DataRepository
import com.pathpulse.driver.network.ScoutRoster
import com.pathpulse.driver.network.ScoutTierInfo
import com.pathpulse.driver.network.ScoutTierLookup
import com.pathpulse.driver.ui.components.PpCard
import com.pathpulse.driver.ui.components.PpCardHeader
import com.pathpulse.driver.ui.components.PpDivider
import com.pathpulse.driver.ui.components.PpPrimaryButton
import com.pathpulse.driver.ui.theme.PpBlack05
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpBlack50
import com.pathpulse.driver.ui.theme.PpBlack70
import com.pathpulse.driver.ui.theme.PpMint
import com.pathpulse.driver.ui.theme.PpMint26
import com.pathpulse.driver.ui.theme.PpMint58
import com.pathpulse.driver.ui.theme.PpMintInk
import com.pathpulse.driver.ui.theme.PpPillShape
import com.pathpulse.driver.ui.theme.PpRed600
import com.pathpulse.driver.ui.theme.PpSize
import com.pathpulse.driver.ui.theme.PpSpace
import com.pathpulse.driver.ui.theme.PpTileShape
import kotlinx.coroutines.launch

@Composable
fun ScoutScreen(
    roster: ScoutRoster?,
    loading: Boolean,
    error: String?,
    onRefresh: () -> Unit,
    dataRepository: DataRepository = remember { DataRepository() },
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    var lookupInput by remember { mutableStateOf("") }
    var lookupResult by remember { mutableStateOf<ScoutTierLookup?>(null) }
    var lookupError by remember { mutableStateOf<String?>(null) }
    var lookingUp by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PpSize.screenPadding)
            .padding(bottom = PpSpace.xxl),
        verticalArrangement = Arrangement.spacedBy(PpSpace.md),
    ) {
        PpTabHeader(title = "SCOUT", loading = loading, onRefresh = onRefresh)

        if (error != null) {
            PpCard {
                Text(error, style = MaterialTheme.typography.bodyMedium, color = PpRed600)
            }
        }

        PpCard {
            PpCardHeader(
                title = "Reputation tiers",
                subtitle = "Classic Assets on Stellar with AUTH_REQUIRED + AUTH_REVOCABLE.",
            )
            if (roster != null) {
                Column(
                    modifier = Modifier.padding(top = PpSpace.md),
                    verticalArrangement = Arrangement.spacedBy(PpSpace.sm),
                ) {
                    LabelValueRow("Issuer", shortAddr(roster.issuer), mono = true)
                    LabelValueRow("Network", roster.network, mono = false)
                }
                PpDivider(modifier = Modifier.padding(vertical = PpSpace.md))
                Column(verticalArrangement = Arrangement.spacedBy(PpSpace.md)) {
                    roster.tiers.forEach { TierLine(it) }
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
                title = "Address lookup",
                subtitle = "Check whether a driver address holds a SCOUT badge.",
            )
            OutlinedTextField(
                value = lookupInput,
                onValueChange = { lookupInput = it },
                singleLine = true,
                placeholder = { Text("G…") },
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                textStyle = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = PpBlack05,
                    unfocusedContainerColor = PpBlack05,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = PpSpace.md),
            )
            PpPrimaryButton(
                text = if (lookingUp) "Looking up…" else "Look up",
                enabled = !lookingUp && lookupInput.isNotBlank(),
                onClick = {
                    val addr = lookupInput.trim()
                    if (addr.isBlank()) return@PpPrimaryButton
                    lookingUp = true
                    lookupError = null
                    lookupResult = null
                    scope.launch {
                        try {
                            lookupResult = dataRepository.scoutLookup(addr)
                        } catch (e: Exception) {
                            lookupError = e.message ?: e.javaClass.simpleName
                        } finally {
                            lookingUp = false
                        }
                    }
                },
                modifier = Modifier.padding(top = PpSpace.md),
            )

            val err = lookupError
            val result = lookupResult
            if (err != null) {
                Text(
                    err,
                    style = MaterialTheme.typography.bodySmall,
                    color = PpRed600,
                    modifier = Modifier.padding(top = PpSpace.md),
                )
            } else if (result != null) {
                LookupResultTile(result)
            }
        }
    }
}

@Composable
private fun TierLine(tier: ScoutTierInfo) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .clip(PpPillShape)
                .background(tierColor(tier.tier))
                .padding(horizontal = PpSpace.sm, vertical = 3.dp),
        ) {
            Text(tier.code, style = MaterialTheme.typography.labelSmall, color = PpMintInk)
        }
        Text(
            "Tier ${tier.tier}",
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(start = PpSpace.sm).weight(1f),
        )
        Text(
            String.format("%.1f×", tier.multiplier),
            style = MaterialTheme.typography.titleMedium,
        )
    }
}

@Composable
private fun LookupResultTile(r: ScoutTierLookup) {
    val tier = r.tier
    val code = r.code
    val mult = r.multiplier

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = PpSpace.md)
            .clip(PpTileShape)
            .background(PpBlack05)
            .padding(PpSpace.md),
    ) {
        if (tier != null && code != null && mult != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier
                        .clip(PpPillShape)
                        .background(tierColor(tier))
                        .padding(horizontal = PpSpace.sm, vertical = 3.dp),
                ) {
                    Text(code, style = MaterialTheme.typography.labelSmall, color = PpMintInk)
                }
                Text(
                    "Tier $tier",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(start = PpSpace.sm).weight(1f),
                )
                Text(
                    String.format("%.1f× multiplier", mult),
                    style = MaterialTheme.typography.bodyMedium,
                    color = PpBlack70,
                )
            }
        } else {
            Text(
                "No SCOUT badge held.",
                style = MaterialTheme.typography.bodyMedium,
                color = PpBlack50,
            )
        }
    }
}

@Composable
private fun LabelValueRow(label: String, value: String, mono: Boolean) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = PpBlack40)
        Box(modifier = Modifier.weight(1f))
        Text(
            value,
            style = MaterialTheme.typography.bodySmall,
            color = PpBlack70,
            fontFamily = if (mono) FontFamily.Monospace else null,
        )
    }
}

private fun tierColor(tier: Int): Color = when (tier) {
    1 -> PpMint26
    2 -> PpMint58
    else -> PpMint
}

private fun shortAddr(a: String): String =
    if (a.length <= 14) a else "${a.take(6)}…${a.takeLast(6)}"
