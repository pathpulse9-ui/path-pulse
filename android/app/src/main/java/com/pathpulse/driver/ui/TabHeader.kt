package com.pathpulse.driver.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.pathpulse.driver.ui.components.PpSecondaryButton
import com.pathpulse.driver.ui.icons.PpIcons
import com.pathpulse.driver.ui.theme.PpSpace

/** Shared tab header: big title + Refresh pill on the right. */
@Composable
fun PpTabHeader(
    title: String,
    loading: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(top = PpSpace.sm, bottom = PpSpace.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(PpSpace.md),
    ) {
        Text(
            title,
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
}
