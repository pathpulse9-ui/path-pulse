package com.pathpulse.driver.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp

val PpShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

val PpPillShape = RoundedCornerShape(50)
val PpCardShape = RoundedCornerShape(28.dp)
val PpTileShape = RoundedCornerShape(12.dp)
val PpBadgeShape = RoundedCornerShape(10.dp)

private val PpColorScheme = lightColorScheme(
    background = PpBackground,
    surface = PpSurface,
    primary = PpBlack,
    onPrimary = PpWhite,
    onBackground = PpBlack,
    onSurface = PpBlack,
    outline = PpBlack10,
    error = PpRed700,
)

@Composable
fun PathPulseTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = PpColorScheme,
        shapes = PpShapes,
        typography = PpTypography,
        content = content,
    )
}
