package com.pathpulse.driver.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.pathpulse.driver.network.SessionUser
import com.pathpulse.driver.ui.components.PpAvatar
import com.pathpulse.driver.ui.components.PpDivider
import com.pathpulse.driver.ui.components.PpMethodBadge
import com.pathpulse.driver.ui.icons.PpIcons
import com.pathpulse.driver.ui.theme.PpBlack05
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpBlack70
import com.pathpulse.driver.ui.theme.PpSize
import com.pathpulse.driver.ui.theme.PpSpace
import com.pathpulse.driver.ui.theme.PpSurface
import com.pathpulse.driver.ui.theme.PpTileShape

val METHOD_LABEL = mapOf("google" to "Google", "wallet" to "Wallet", "guest" to "Guest")

fun sessionLabel(user: SessionUser): String =
    user.email ?: user.address?.let { "${it.take(6)}…${it.takeLast(4)}" } ?: "Guest session"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileSheet(
    user: SessionUser,
    onDismiss: () -> Unit,
    onSignOut: () -> Unit,
) {
    val label = sessionLabel(user)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = PpSurface,
        sheetState = rememberModalBottomSheetState(),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = PpSize.screenPadding)
                .padding(bottom = PpSpace.lg)
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(bottom = PpSpace.lg),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PpAvatar(initial = label.take(1).uppercase(), size = 44.dp)
                Column(modifier = Modifier.padding(start = PpSpace.md).weight(1f)) {
                    Text(label, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    Text(
                        "Signed in with ${METHOD_LABEL[user.method] ?: user.method}",
                        style = MaterialTheme.typography.bodySmall,
                        color = PpBlack40,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
                PpMethodBadge(METHOD_LABEL[user.method] ?: user.method)
            }

            if (user.address != null) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(PpTileShape)
                        .background(PpBlack05)
                        .padding(PpSpace.md),
                ) {
                    Text(
                        "Managed wallet",
                        style = MaterialTheme.typography.labelMedium,
                        color = PpBlack40,
                    )
                    Text(
                        user.address,
                        style = MaterialTheme.typography.bodySmall,
                        fontFamily = FontFamily.Monospace,
                        color = PpBlack70,
                        modifier = Modifier.padding(top = PpSpace.xs),
                    )
                }
            }

            PpDivider(modifier = Modifier.padding(vertical = PpSpace.lg))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(PpTileShape)
                    .clickable(onClick = onSignOut)
                    .padding(horizontal = PpSpace.md)
                    .height(PpSize.control),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(PpSpace.md),
            ) {
                Icon(
                    PpIcons.SignOut,
                    contentDescription = null,
                    tint = Color.Black,
                    modifier = Modifier.size(18.dp),
                )
                Text(
                    if (user.method == "guest") "Exit guest session" else "Sign out",
                    style = MaterialTheme.typography.labelLarge,
                    color = Color.Black,
                )
            }
        }
    }
}
