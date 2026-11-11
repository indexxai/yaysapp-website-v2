import UIKit
import UserNotifications
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import livekit_react_native

@main
class AppDelegate: RCTAppDelegate {
  override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {
    // Calls: LiveKit's WebRTC setup, before React Native starts.
    LivekitReactNative.setup()
    // Notifications: tapping one, or one arriving while YaysApp is open, comes through here.
    UNUserNotificationCenter.current().delegate = self

    self.moduleName = "YaysApp"
    self.dependencyProvider = RCTAppDependencyProvider()

    // You can add your custom initial props in the dictionary below.
    // They will be passed down to the ViewController used by React Native.
    self.initialProps = [:]

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // ---- Notifications (Apple's push service), passed on to the app's JavaScript ----
  // RCTAppDelegate implements only app launch, so these are new methods (not overrides), named for Objective-C.
  @objc(application:didRegisterForRemoteNotificationsWithDeviceToken:)
  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    RNCPushNotificationIOS.didRegisterForRemoteNotifications(withDeviceToken: deviceToken)
  }
  @objc(application:didFailToRegisterForRemoteNotificationsWithError:)
  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    RNCPushNotificationIOS.didFailToRegisterForRemoteNotificationsWithError(error as NSError)
  }
  /** Silent pushes ("read on another device", "the call stopped ringing"). */
  @objc(application:didReceiveRemoteNotification:fetchCompletionHandler:)
  func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
    RNCPushNotificationIOS.didReceiveRemoteNotification(userInfo, fetchCompletionHandler: completionHandler)
  }

  // ---- yaysapp:// links (Facebook sign-in comes back this way) ----
  @objc(application:openURL:options:)
  func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    RCTLinkingManager.application(app, open: url, options: options)
  }

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
  /** Tapped a notification: the app opens the chat or the call. */
  @objc(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:)
  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    RNCPushNotificationIOS.didReceive(response)
    completionHandler()
  }
  /** While YaysApp is open the server doesn't send notifications; one that slips through still shows as a banner. */
  @objc(userNotificationCenter:willPresentNotification:withCompletionHandler:)
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.banner, .sound, .list])
  }
}
