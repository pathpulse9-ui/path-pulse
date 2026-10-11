import UIKit
import UserNotifications

@MainActor
final class PushRegistrar {
    static let shared = PushRegistrar()

    private let data = DataRepository()
    private var deviceToken: String?
    private var signedIn = false

    func userSignedIn() async {
        signedIn = true
        let center = UNUserNotificationCenter.current()
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard granted else { return }
        UIApplication.shared.registerForRemoteNotifications()
        await upload()
    }

    func userSigningOut() async {
        signedIn = false
        guard let deviceToken else { return }
        try? await data.unregisterPushDevice(token: deviceToken)
    }

    func received(deviceToken token: Data) async {
        deviceToken = token.map { String(format: "%02x", $0) }.joined()
        await upload()
    }

    private func upload() async {
        guard signedIn, let deviceToken else { return }
        try? await data.registerPushDevice(token: deviceToken)
    }
}

final class PushAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await PushRegistrar.shared.received(deviceToken: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {}

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}
