import XCTest

final class N04NavigationUITests: XCTestCase {
    func testRequestsNativeEdgeDrag() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.bundleen.bundleen.development")
        // Sole initial launch owner. Never activate, relaunch or recover after this.
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30))
        let marker = app.descendants(matching: .any)["N04Marker"].firstMatch
        let ready = NSPredicate { _, _ in
            app.state == .runningForeground && marker.exists && marker.label.hasSuffix("|ready")
        }
        let readiness = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: nil)], timeout: 60)
        if readiness != .completed {
            // Diagnostic-only, synthetic content. Never retry or relax readiness.
            let exists = marker.exists
            let components = "expectedPhase=ready foreground=\(app.state == .runningForeground) markerExists=\(exists) label=\(exists ? String(marker.label.prefix(256)) : "absent")"
            let diagnostic = XCTAttachment(string: components + "\n" + String(app.debugDescription.prefix(16000)))
            diagnostic.name = "N04_READINESS_DIAGNOSTIC"
            diagnostic.lifetime = .keepAlways
            add(diagnostic)
            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name = "synthetic-n04-readiness-failure"
            screenshot.lifetime = .keepAlways
            add(screenshot)
        }
        XCTAssertEqual(readiness, .completed)
        let initial = marker.label
        let fields = initial.split(separator: "|", omittingEmptySubsequences: false)
        XCTAssertEqual(fields.count, 5)
        XCTAssertEqual(fields[0], "N04")
        XCTAssertFalse(fields[1].isEmpty) // engine nonce
        XCTAssertNotNil(Int(fields[2])) // process ID reported by the fixture
        XCTAssertTrue(fields[3].hasPrefix("isolates/"))
        XCTAssertEqual(fields[4], "ready")
        let before = XCTAttachment(screenshot: app.screenshot())
        before.name = "synthetic-n04-100-ready"
        before.lifetime = .keepAlways
        add(before)
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertEqual(marker.label, initial)
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5))
        // Public iOS touch injection: actual native input, not WidgetTester.drag.
        start.press(forDuration: 0.1, thenDragTo: end)
        let delivery: [String: Any] = [
            "event": "N04_XCUI_DRAG_DELIVERED",
            "nonce": String(fields[1]),
            "processId": String(fields[2]),
            "isolateId": String(fields[3]),
            "fromNormalized": [0.01, 0.5],
            "toNormalized": [0.85, 0.5],
            "pressSeconds": 0.1,
            "timestamp": ISO8601DateFormatter().string(from: Date())
        ]
        let deliveryData = try JSONSerialization.data(withJSONObject: delivery, options: [.sortedKeys])
        let deliveryText = String(decoding: deliveryData, as: UTF8.self)
        print(deliveryText)
        let deliveryAttachment = XCTAttachment(string: deliveryText)
        deliveryAttachment.name = "N04_XCUI_DRAG_DELIVERED"
        deliveryAttachment.lifetime = .keepAlways
        add(deliveryAttachment)
        let expected = initial.replacingOccurrences(of: "|ready", with: "|observed")
        var invalidated = false
        let observed = NSPredicate { _, _ in
            if app.state != .runningForeground || !marker.exists {
                invalidated = true
            } else if marker.label != initial && marker.label != expected {
                invalidated = true
            }
            return invalidated || marker.label == expected
        }
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: observed, object: nil)], timeout: 20), .completed)
        XCTAssertEqual(app.state, .runningForeground)
        XCTAssertFalse(invalidated, "Checkpoint lost foreground or engine identity")
        XCTAssertEqual(marker.label, expected)
        let after = XCTAttachment(screenshot: app.screenshot())
        after.name = "synthetic-n04-100-observed"
        after.lifetime = .keepAlways
        add(after)
    }
}
