import XCTest

final class N04NavigationUITests: XCTestCase {
    func testNativeNavigationMatrix() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.bundleen.bundleen.development")
        // Sole launch. All subsequent setup replaces only synthetic Dart models.
        app.launch()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 30))
        let marker = app.descendants(matching: .any)["N04Marker"].firstMatch
        var identity: [String]?
        var previousObserved: String?
        let names = ["requests", "inbox-detail", "inbox-list", "signed-out"]
        func screenshot(_ name: String) {
            let a = XCTAttachment(screenshot: app.screenshot())
            a.name = name; a.lifetime = .keepAlways; add(a)
        }
        func waitFor(_ scale: Int, _ step: Int, _ name: String, _ phase: String,
                     _ count: Int, timeout: TimeInterval, allowed: Set<String>) -> String {
            var result = ""
            var invalid: String?
            let predicate = NSPredicate { _, _ in
                if app.state != .runningForeground { invalid = "not-foreground"; return true }
                if !marker.exists {
                    if identity != nil { invalid = "marker-disappeared"; return true }
                    return false
                }
                let label = marker.label
                let f = label.components(separatedBy: "|")
                guard f.count == 9, f[0] == "N04", !f[1].isEmpty,
                      Int(f[2]) != nil, f[3].hasPrefix("isolates/") else {
                    invalid = "malformed-marker"; return true
                }
                let run = Array(f[1...3])
                if let existing = identity, existing != run { invalid = "identity-changed"; return true }
                identity = run
                let expected = "N04|" + run.joined(separator: "|") + "|\(scale)|\(step)|\(name)|\(phase)|\(count)"
                if label == expected { result = label; return true }
                let setup = "N04|" + run.joined(separator: "|") + "|\(scale)|\(step)|\(name)|setup|0"
                if allowed.contains(label) || (phase == "ready" && label == setup) { return false }
                invalid = "unexpected-phase-or-step"; return true
            }
            let outcome = XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: nil)], timeout: timeout)
            if outcome != .completed || invalid != nil || result.isEmpty {
                let exists = marker.exists
                let text = "expected=\(scale)/\(step)/\(name)/\(phase)/\(count) foreground=\(app.state == .runningForeground) markerExists=\(exists) invalid=\(invalid ?? "deadline") label=\(exists ? String(marker.label.prefix(512)) : "absent")"
                let a = XCTAttachment(string: text + "\n" + String(app.debugDescription.prefix(16000)))
                a.name = "N04_FAILURE_\(step)_\(phase)"; a.lifetime = .keepAlways; add(a)
                screenshot("synthetic-n04-failure-\(step)-\(phase)")
            }
            XCTAssertEqual(outcome, .completed)
            XCTAssertNil(invalid)
            XCTAssertFalse(result.isEmpty)
            return result
        }
        for step in 1...8 {
            let scale = step <= 4 ? 100 : 200
            let name = names[(step - 1) % 4]
            let allowed: Set<String> = previousObserved.map { Set([$0]) } ?? []
            let ready = waitFor(scale, step, name, "ready", 0, timeout: 60, allowed: allowed)
            screenshot("synthetic-n04-\(scale)-\(step)-ready")
            XCTAssertEqual(app.state, .runningForeground)
            XCTAssertEqual(marker.label, ready)
            let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5))
            let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5))
            start.press(forDuration: 0.1, thenDragTo: end)
            let delivery: [String: Any] = ["event": "N04_XCUI_DRAG_DELIVERED",
                "readyMarker": ready, "step": step, "scale": scale,
                "fromNormalized": [0.01, 0.5], "toNormalized": [0.85, 0.5],
                "pressSeconds": 0.1, "sequenceBaseline": 0,
                "timestamp": ISO8601DateFormatter().string(from: Date())]
            let text = String(decoding: try JSONSerialization.data(withJSONObject: delivery, options: [.sortedKeys]), as: UTF8.self)
            print(text)
            let a = XCTAttachment(string: text)
            a.name = "N04_XCUI_DRAG_DELIVERED_\(step)"; a.lifetime = .keepAlways; add(a)
            let observed = waitFor(scale, step, name, "observed", 1, timeout: 20, allowed: [ready])
            let factsElement = app.descendants(matching: .any)["N04PointerFacts"].firstMatch
            XCTAssertTrue(factsElement.exists)
            let factsText = factsElement.label
            XCTAssertLessThan(factsText.count, 2048)
            let facts = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(factsText.utf8)) as? [String: Any])
            XCTAssertEqual(facts["identity"] as? String, identity!.joined(separator: "|"))
            XCTAssertEqual(facts["step"] as? Int, step)
            XCTAssertEqual(facts["scale"] as? Int, scale)
            XCTAssertEqual(facts["name"] as? String, name)
            XCTAssertEqual(facts["source"] as? String, "DEVICE")
            XCTAssertEqual(facts["completed"] as? Int, 1)
            XCTAssertEqual(facts["downCount"] as? Int, 1)
            XCTAssertEqual(facts["upCount"] as? Int, 1)
            XCTAssertGreaterThan(try XCTUnwrap(facts["moveCount"] as? Int), 0)
            let audit = XCTAttachment(string: factsText)
            audit.name = "N04_DEVICE_FACTS_\(step)"; audit.lifetime = .keepAlways; add(audit)
            screenshot("synthetic-n04-\(scale)-\(step)-observed")
            previousObserved = observed
        }
        _ = waitFor(200, 8, "signed-out", "complete", 1, timeout: 30, allowed: [previousObserved!])
        screenshot("synthetic-n04-final-complete")
    }
}
