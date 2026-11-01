package com.bundleen.bundleen

import com.clerk.api.Clerk
import com.clerk.api.auth.HostedAuthMode
import com.clerk.api.hostedauth.HostedAuthCancellationException
import com.clerk.api.network.serialization.ClerkResult
import com.clerk.api.session.GetTokenOptions
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

class MainActivity : FlutterActivity() {
    private val authScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var configuredKey: String? = null
    private var operationRunning = false

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "bundleen/auth")
            .setMethodCallHandler { call, result ->
                if (operationRunning) {
                    result.error("busy", "Authentication is already in progress.", null)
                    return@setMethodCallHandler
                }
                operationRunning = true
                authScope.launch {
                    try {
                        when (call.method) {
                            "initialize" -> {
                                val key = call.argument<String>("publishableKey")
                                require(key != null && (key.startsWith("pk_test_") || key.startsWith("pk_live_")))
                                require(configuredKey == null || configuredKey == key)
                                if (configuredKey == null) {
                                    Clerk.telemetryEnabled = false
                                    Clerk.initialize(this@MainActivity, key)
                                    configuredKey = key
                                } else if (!Clerk.isInitialized.value && Clerk.initializationError.value != null) {
                                    check(Clerk.reinitialize())
                                }
                                withTimeout(30_000) {
                                    combine(Clerk.isInitialized, Clerk.initializationError) { ready, error ->
                                        error?.let { throw it }
                                        ready
                                    }.first { it }
                                }
                                result.success(Clerk.session != null)
                            }
                            "signIn", "signUp" -> {
                                check(Clerk.isInitialized.value)
                                val mode = if (call.method == "signUp") HostedAuthMode.SIGN_UP else HostedAuthMode.SIGN_IN
                                when (val response = Clerk.auth.startHostedAuth(mode = mode)) {
                                    is ClerkResult.Success -> result.success(null)
                                    is ClerkResult.Failure -> {
                                        val code = if (response.throwable is HostedAuthCancellationException) "cancelled" else "auth_failed"
                                        result.error(code, "Authentication did not complete. Please try again.", null)
                                    }
                                }
                            }
                            "getToken" -> {
                                check(Clerk.isInitialized.value)
                                if (Clerk.session == null) result.success(null)
                                else when (val response = Clerk.auth.getToken(GetTokenOptions(skipCache = call.argument<Boolean>("forceRefresh") ?: false))) {
                                    is ClerkResult.Success -> result.success(response.value)
                                    is ClerkResult.Failure -> result.error("token_failed", "Session refresh failed. Please sign in again.", null)
                                }
                            }
                            "signOut" -> {
                                check(Clerk.isInitialized.value)
                                when (Clerk.auth.signOut()) {
                                    is ClerkResult.Success -> result.success(null)
                                    is ClerkResult.Failure -> result.error("sign_out_failed", "Sign out could not complete. Please retry.", null)
                                }
                            }
                            else -> result.notImplemented()
                        }
                    } catch (_: TimeoutCancellationException) {
                        result.error("timeout", "Authentication timed out. Please try again.", null)
                    } catch (error: CancellationException) {
                        result.error("cancelled", "Authentication was interrupted.", null)
                        throw error
                    } catch (_: Exception) {
                        // Provider exceptions can contain identifiers or URLs. Do not forward them.
                        result.error("auth_unavailable", "Authentication is unavailable. Check your connection and try again.", null)
                    } finally {
                        operationRunning = false
                    }
                }
            }
    }

    override fun onDestroy() {
        authScope.cancel()
        super.onDestroy()
    }
}
