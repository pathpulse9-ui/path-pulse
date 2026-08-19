package com.pathpulse.driver.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.pathpulse.driver.ui.theme.PpBadgeShape
import com.pathpulse.driver.ui.theme.PpBlack05
import com.pathpulse.driver.ui.theme.PpBlack50
import com.pathpulse.driver.ui.theme.PpBlack60
import com.pathpulse.driver.ui.theme.PpPillShape
import com.pathpulse.driver.ui.theme.PpSize
import com.pathpulse.driver.ui.theme.PpSurface

@Composable
fun PpStatusPill(
    text: String,
    dotColor: Color,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(PpPillShape)
            .background(PpSurface)
            .border(1.dp, PpBlack05, PpPillShape)
            .padding(horizontal = 14.dp)
            .height(36.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .size(6.dp)
                .clip(CircleShape)
                .background(dotColor),
        )
        Text(text, style = MaterialTheme.typography.bodySmall, color = PpBlack60)
    }
}

@Composable
fun PpMethodBadge(text: String, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .clip(PpPillShape)
            .background(PpBlack05)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    ) {
        Text(
            text.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = PpBlack50,
        )
    }
}

@Composable
fun PpSquareBadge(
    text: String,
    background: Color,
    contentColor: Color,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .size(PpSize.badge)
            .clip(PpBadgeShape)
            .background(background),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = MaterialTheme.typography.labelMedium, color = contentColor)
    }
}

@Composable
fun PpAvatar(
    initial: String,
    modifier: Modifier = Modifier,
    size: androidx.compose.ui.unit.Dp = PpSize.avatar,
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(Color.Black),
        contentAlignment = Alignment.Center,
    ) {
        Text(initial, style = MaterialTheme.typography.labelMedium, color = Color.White)
    }
}

@Composable
fun PpLegendSwatch(color: Color, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .size(10.dp)
            .clip(RoundedCornerShape(3.dp))
            .background(color),
    )
}
