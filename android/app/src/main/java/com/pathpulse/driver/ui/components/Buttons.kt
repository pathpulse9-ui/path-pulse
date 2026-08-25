package com.pathpulse.driver.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import com.pathpulse.driver.ui.icons.PpIcons
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import com.pathpulse.driver.ui.theme.PpBlack10
import com.pathpulse.driver.ui.theme.PpMint
import com.pathpulse.driver.ui.theme.PpMintInk
import com.pathpulse.driver.ui.theme.PpPillShape
import com.pathpulse.driver.ui.theme.PpSize
import com.pathpulse.driver.ui.theme.PpSurface

@Composable
fun PpPrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    fillWidth: Boolean = true,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = PpPillShape,
        colors = ButtonDefaults.buttonColors(
            containerColor = PpMint,
            contentColor = PpMintInk,
        ),
        modifier = modifier
            .then(if (fillWidth) Modifier.fillMaxWidth() else Modifier)
            .height(PpSize.control),
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun PpSecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    fillWidth: Boolean = true,
    icon: ImageVector? = null,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        shape = PpPillShape,
        border = BorderStroke(1.dp, SolidColor(PpBlack10)),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = PpSurface,
            contentColor = Color.Black,
        ),
        modifier = modifier
            .then(if (fillWidth) Modifier.fillMaxWidth() else Modifier)
            .height(PpSize.control),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, modifier = Modifier.size(16.dp))
            }
            Text(text, style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
fun PpArrowButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    fillWidth: Boolean = false,
) {
    Button(
        onClick = onClick,
        shape = PpPillShape,
        contentPadding = PaddingValues(start = 28.dp, end = 6.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = PpMint,
            contentColor = PpMintInk,
        ),
        modifier = modifier
            .then(if (fillWidth) Modifier.fillMaxWidth() else Modifier)
            .height(PpSize.control),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(text, style = MaterialTheme.typography.labelLarge)
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(PpMintInk),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    PpIcons.ArrowRight,
                    contentDescription = null,
                    tint = PpMint,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}
