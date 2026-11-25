import AuthenticationServices
import ClerkKit
import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var authChannel: FlutterMethodChannel?
  private var configuredKey: String?
  private var operationRunning = false

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "BundleenAuth")!
    let channel = FlutterMethodChannel(name: "bundleen/auth", binaryMessenger: registrar.messenger())
    authChannel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      Task { @MainActor in
        guard let self else { return }
        guard !self.operationRunning else {
          result(FlutterError(code: "busy", message: "Authentication is already in progress.", details: nil))
          return
        }
        self.operationRunning = true
        defer { self.operationRunning = false }
        do {
          switch call.method {
          case "initialize":
            guard let config = call.arguments as? [String: Any],
                  let key = config["publishableKey"] as? String,
                  Self.validPublishableKey(key),
                  self.configuredKey == nil || self.configuredKey == key else {
              result(FlutterError(code: "configuration", message: "Authentication configuration is invalid.", details: nil))
              return
            }
            if self.configuredKey == nil {
              Clerk.configure(publishableKey: key, options: .init(telemetryEnabled: false))
              self.configuredKey = key
            } else if !Clerk.shared.isLoaded {
              // Retry transient bootstrap failures without reconfiguring or deleting stored identity.
              _ = try await Clerk.shared.refreshEnvironment()
              _ = try await Clerk.shared.refreshClient()
            }
            let deadline = Date().addingTimeInterval(30)
            while !Clerk.shared.isLoaded {
              guard Date() < deadline else { throw AuthBridgeError.timeout }
              try await Task.sleep(for: .milliseconds(100))
            }
            result(Clerk.shared.session != nil)
          case "signIn", "signUp":
            guard self.configuredKey != nil else { throw AuthBridgeError.uninitialized }
            try await Clerk.shared.auth.startHostedAuth(mode: call.method == "signUp" ? .signUp : .signIn)
            result(nil)
          case "getToken":
            guard self.configuredKey != nil else { throw AuthBridgeError.uninitialized }
            let args = call.arguments as? [String: Any]
            let forceRefresh = args?["forceRefresh"] as? Bool ?? false
            result(try await Clerk.shared.auth.getToken(.init(skipCache: forceRefresh)))
          case "signOut":
            guard self.configuredKey != nil else { throw AuthBridgeError.uninitialized }
            try await Clerk.shared.auth.signOut()
            result(nil)
          default:
            result(FlutterMethodNotImplemented)
          }
        } catch {
          let nsError = error as NSError
          let cancelled = error is CancellationError ||
            (nsError.domain == ASWebAuthenticationSessionError.errorDomain &&
             nsError.code == ASWebAuthenticationSessionError.canceledLogin.rawValue)
          result(FlutterError(code: cancelled ? "cancelled" : "auth_unavailable",
                              message: cancelled ? "Authentication was cancelled." : "Authentication is unavailable. Please try again.",
                              details: nil))
        }
      }
    }
  }

  // Clerk.configure asserts on malformed public configuration in debug builds.
  // This only validates its encoded host format; it never verifies identity or tokens.
  private static func validPublishableKey(_ key: String) -> Bool {
    guard key.hasPrefix("pk_test_") || key.hasPrefix("pk_live_") else { return false }
    var encoded = String(key.dropFirst(8))
    encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
    guard let data = Data(base64Encoded: encoded), let value = String(data: data, encoding: .utf8),
          value.hasSuffix("$"), let url = URL(string: "https://" + value.dropLast()),
          url.host?.isEmpty == false, url.user == nil, url.password == nil else { return false }
    return true
  }
}

private enum AuthBridgeError: Error {
  case timeout
  case uninitialized
}
