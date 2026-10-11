package com.pathpulse.driver.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.pathpulse.driver.BuildConfig
import com.pathpulse.driver.R
import com.pathpulse.driver.network.DataRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

private const val TAG = "PathPulsePush"
private const val CHANNEL_ID = "payouts"

object PushRegistration {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var configured = false
    private var signedIn = false

    val isConfigured: Boolean get() = configured

    fun init(context: Context) {
        if (BuildConfig.FIREBASE_APP_ID.isEmpty() || BuildConfig.FIREBASE_PROJECT_ID.isEmpty()) return
        if (FirebaseApp.getApps(context).isEmpty()) {
            FirebaseApp.initializeApp(
                context,
                FirebaseOptions.Builder()
                    .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                    .setApiKey(BuildConfig.FIREBASE_API_KEY)
                    .setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    .build(),
            )
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Payouts", NotificationManager.IMPORTANCE_DEFAULT),
        )
        configured = true
    }

    suspend fun register(dataRepository: DataRepository) {
        signedIn = true
        val token = currentToken() ?: return
        runCatching { dataRepository.registerPushDevice(token) }
            .onFailure { Log.w(TAG, "device registration failed", it) }
    }

    suspend fun unregister(dataRepository: DataRepository) {
        signedIn = false
        val token = currentToken() ?: return
        runCatching { dataRepository.unregisterPushDevice(token) }
    }

    fun onNewToken(token: String) {
        if (!signedIn) return
        scope.launch {
            runCatching { DataRepository().registerPushDevice(token) }
                .onFailure { Log.w(TAG, "token refresh registration failed", it) }
        }
    }

    private suspend fun currentToken(): String? {
        if (!configured) return null
        return suspendCancellableCoroutine { cont ->
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                cont.resume(if (task.isSuccessful) task.result else null)
            }
        }
    }

    fun show(context: Context, title: String, body: String) {
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .build()
        context.getSystemService(NotificationManager::class.java)
            .notify(System.currentTimeMillis().toInt(), notification)
    }
}

class PushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        PushRegistration.onNewToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val notification = message.notification ?: return
        PushRegistration.show(this, notification.title.orEmpty(), notification.body.orEmpty())
    }
}
