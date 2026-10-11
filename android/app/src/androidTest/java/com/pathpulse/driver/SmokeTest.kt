package com.pathpulse.driver

import android.content.Context
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

private const val NETWORK_TIMEOUT_MS = 20_000L

@RunWith(AndroidJUnit4::class)
class SmokeTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Before
    fun signedOut() {
        InstrumentationRegistry.getInstrumentation().targetContext
            .getSharedPreferences("pathpulse_secure", Context.MODE_PRIVATE)
            .edit().clear().commit()
    }

    private fun waitFor(text: String) {
        compose.waitUntil(NETWORK_TIMEOUT_MS) {
            compose.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun guestReachesDashboardAndOffRampWithTheSessionPersistedEncrypted() {
        ActivityScenario.launch(MainActivity::class.java).use {
            waitFor("Get started")
            compose.onNodeWithText(BuildConfig.STELLAR_NETWORK.uppercase()).assertExists()
            compose.onNodeWithText("Get started").performClick()

            waitFor("Continue as Guest")
            compose.onNodeWithText("Continue as Guest").performClick()

            waitFor("My rewards")
            compose.onAllNodesWithText("Off-ramp").onFirst().performClick()
            waitFor("withdrawal")
        }

        val stored = InstrumentationRegistry.getInstrumentation().targetContext
            .getSharedPreferences("pathpulse_secure", Context.MODE_PRIVATE)
            .getString("session_cookie", null)
        assertNotNull("the session should be persisted for the next launch", stored)
        assertFalse("the persisted session must be encrypted", stored!!.contains("eyJ"))
    }
}
