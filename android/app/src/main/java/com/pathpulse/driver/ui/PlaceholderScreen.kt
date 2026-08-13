package com.pathpulse.driver.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import com.pathpulse.driver.ui.components.PpCard
import com.pathpulse.driver.ui.components.PpEmptyState
import com.pathpulse.driver.ui.theme.PathPulseTheme
import com.pathpulse.driver.ui.theme.PpSize
import com.pathpulse.driver.ui.theme.PpSpace

@Composable
fun PlaceholderScreen(
    title: String,
    message: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .padding(horizontal = PpSize.screenPadding)
            .padding(bottom = PpSpace.xxl),
        verticalArrangement = Arrangement.spacedBy(PpSpace.md),
    ) {
        Text(
            title,
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = PpSpace.sm, bottom = PpSpace.xs),
        )
        PpCard {
            PpEmptyState(title = "Coming to mobile", message = message)
        }
    }
}

@Preview(showBackground = true, backgroundColor = 0xFFF5F5F5)
@Composable
private fun PlaceholderScreenPreview() {
    PathPulseTheme {
        PlaceholderScreen(
            title = "Treasury",
            message = "Multisig thresholds and signer management are available in the web console.",
        )
    }
}
