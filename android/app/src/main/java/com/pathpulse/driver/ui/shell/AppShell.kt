package com.pathpulse.driver.ui.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.pathpulse.driver.network.HealthResponse
import com.pathpulse.driver.ui.components.PpAvatar
import com.pathpulse.driver.ui.components.PpStatusPill
import com.pathpulse.driver.ui.icons.PpIcons
import com.pathpulse.driver.ui.theme.PpBackground
import com.pathpulse.driver.ui.theme.PpBlack05
import com.pathpulse.driver.ui.theme.PpBlack40
import com.pathpulse.driver.ui.theme.PpGreen500
import com.pathpulse.driver.ui.theme.PpRed500
import com.pathpulse.driver.ui.theme.PpSize
import com.pathpulse.driver.ui.theme.PpSpace
import com.pathpulse.driver.ui.theme.PpSurface

enum class PpTab(val label: String, val icon: ImageVector) {
    Dashboard("Dashboard", PpIcons.Dashboard),
    Settlement("Settlement", PpIcons.Settlement),
    Scout("SCOUT", PpIcons.Scout),
    OffRamp("Off-ramp", PpIcons.OffRamp),
    Treasury("Treasury", PpIcons.Treasury),
}

@Composable
fun AppShell(
    selectedTab: PpTab,
    onSelectTab: (PpTab) -> Unit,
    health: HealthResponse?,
    avatarInitial: String,
    onOpenProfile: () -> Unit,
    content: @Composable (Modifier) -> Unit,
) {
    Scaffold(
        containerColor = PpBackground,
        topBar = { PpTopBar(health = health, avatarInitial = avatarInitial, onOpenProfile = onOpenProfile) },
        bottomBar = { PpBottomNav(selected = selectedTab, onSelect = onSelectTab) },
    ) { padding ->
        content(Modifier.fillMaxSize().padding(padding))
    }
}

@Composable
private fun PpTopBar(
    health: HealthResponse?,
    avatarInitial: String,
    onOpenProfile: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(PpBackground)
            .windowInsetsPadding(WindowInsets.statusBars)
            .height(PpSize.topBar)
            .padding(horizontal = PpSize.screenPadding),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PpStatusPill(
            text = if (health != null) "Core · ${health.network}" else "Core unreachable",
            dotColor = if (health != null) PpGreen500 else PpRed500,
        )
        Box(modifier = Modifier.weight(1f))
        PpAvatar(
            initial = avatarInitial,
            modifier = Modifier
                .clip(RoundedCornerShape(50))
                .clickable(onClick = onOpenProfile),
        )
    }
}

@Composable
private fun PpBottomNav(selected: PpTab, onSelect: (PpTab) -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().background(PpSurface)) {
        Box(modifier = Modifier.fillMaxWidth().height(1.dp).background(PpBlack05))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.navigationBars)
                .height(PpSize.bottomNav),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PpTab.entries.forEach { tab ->
                PpNavItem(
                    tab = tab,
                    selected = tab == selected,
                    onClick = { onSelect(tab) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun PpNavItem(
    tab: PpTab,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tint = if (selected) Color.Black else PpBlack40
    Column(
        modifier = modifier
            .fillMaxSize()
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick,
            ),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(tab.icon, contentDescription = tab.label, tint = tint, modifier = Modifier.size(22.dp))
        Text(
            tab.label,
            style = if (selected) MaterialTheme.typography.labelMedium else MaterialTheme.typography.bodySmall,
            color = tint,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = PpSpace.xs),
        )
    }
}
