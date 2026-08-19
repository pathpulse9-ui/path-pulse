package com.pathpulse.driver.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import com.pathpulse.driver.ui.theme.PpBlack50
import com.pathpulse.driver.ui.theme.PpSpace
import kotlin.math.roundToInt

@Composable
fun PpMarquee(
    items: List<String>,
    modifier: Modifier = Modifier,
    durationMillis: Int = 22_000,
    color: Color = PpBlack50,
) {
    var copyWidth by remember { mutableIntStateOf(0) }
    val transition = rememberInfiniteTransition(label = "marquee")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(durationMillis, easing = LinearEasing)),
        label = "marqueeOffset",
    )

    Box(modifier = modifier.clipToBounds()) {
        Row(
            modifier = Modifier
                .onSizeChanged { copyWidth = it.width / 2 }
                .offset { IntOffset(-(progress * copyWidth).roundToInt(), 0) },
        ) {
            repeat(2) {
                items.forEach { label ->
                    Text(
                        label,
                        style = MaterialTheme.typography.bodySmall,
                        color = color,
                        maxLines = 1,
                        overflow = TextOverflow.Clip,
                        modifier = Modifier.padding(end = PpSpace.xxl),
                    )
                }
            }
        }
    }
}
