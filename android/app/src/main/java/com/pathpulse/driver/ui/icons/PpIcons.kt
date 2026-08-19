package com.pathpulse.driver.ui.icons

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private fun ppIcon(name: String, block: PathBuilder.() -> Unit): ImageVector =
    ImageVector.Builder(
        name = name,
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
    ).apply {
        path(
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 2f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
            pathBuilder = block,
        )
    }.build()

private fun PathBuilder.rect(x: Float, y: Float, w: Float, h: Float) {
    moveTo(x, y)
    lineTo(x + w, y)
    lineTo(x + w, y + h)
    lineTo(x, y + h)
    close()
}

private fun PathBuilder.circle(cx: Float, cy: Float, r: Float) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, true, true, cx + r, cy)
    arcTo(r, r, 0f, true, true, cx - r, cy)
}

object PpIcons {

    val ArrowRight: ImageVector = ppIcon("ArrowRight") {
        moveTo(5f, 12f); lineTo(19f, 12f)
        moveTo(13f, 6f); lineTo(19f, 12f); lineTo(13f, 18f)
    }

    val Dashboard: ImageVector = ppIcon("Dashboard") {
        rect(3f, 3f, 7f, 7f)
        rect(14f, 3f, 7f, 7f)
        rect(14f, 14f, 7f, 7f)
        rect(3f, 14f, 7f, 7f)
    }

    val Settlement: ImageVector = ppIcon("Settlement") {
        moveTo(8f, 3f); lineTo(4f, 7f); lineTo(8f, 11f)
        moveTo(4f, 7f); lineTo(20f, 7f)
        moveTo(16f, 21f); lineTo(20f, 17f); lineTo(16f, 13f)
        moveTo(20f, 17f); lineTo(4f, 17f)
    }

    val Scout: ImageVector = ppIcon("Scout") {
        circle(12f, 8f, 6f)
        moveTo(15.48f, 12.89f); lineTo(17f, 22f); lineTo(12f, 19f); lineTo(7f, 22f); lineTo(8.52f, 12.89f)
    }

    val OffRamp: ImageVector = ppIcon("OffRamp") {
        rect(2f, 6f, 20f, 12f)
        circle(12f, 12f, 2f)
        moveTo(6f, 12f); lineTo(6.01f, 12f)
        moveTo(18f, 12f); lineTo(18.01f, 12f)
    }

    val Treasury: ImageVector = ppIcon("Treasury") {
        moveTo(3f, 7f); lineTo(12f, 2f); lineTo(21f, 7f); close()
        moveTo(6f, 18f); lineTo(6f, 11f)
        moveTo(10f, 18f); lineTo(10f, 11f)
        moveTo(14f, 18f); lineTo(14f, 11f)
        moveTo(18f, 18f); lineTo(18f, 11f)
        moveTo(3f, 22f); lineTo(21f, 22f)
    }

    val User: ImageVector = ppIcon("User") {
        moveTo(19f, 21f); lineTo(19f, 19f)
        arcTo(4f, 4f, 0f, false, false, 15f, 15f)
        lineTo(9f, 15f)
        arcTo(4f, 4f, 0f, false, false, 5f, 19f)
        lineTo(5f, 21f)
        circle(12f, 7f, 4f)
    }

    val Refresh: ImageVector = ppIcon("Refresh") {
        moveTo(21f, 12f)
        arcTo(9f, 9f, 0f, true, true, 18.36f, 5.64f)
        moveTo(21f, 3f); lineTo(21f, 9f); lineTo(15f, 9f)
    }

    val SignOut: ImageVector = ppIcon("SignOut") {
        moveTo(9f, 21f); lineTo(5f, 21f)
        arcTo(2f, 2f, 0f, false, true, 3f, 19f)
        lineTo(3f, 5f)
        arcTo(2f, 2f, 0f, false, true, 5f, 3f)
        lineTo(9f, 3f)
        moveTo(16f, 17f); lineTo(21f, 12f); lineTo(16f, 7f)
        moveTo(21f, 12f); lineTo(9f, 12f)
    }
}
