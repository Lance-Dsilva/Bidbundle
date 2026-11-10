# N04 semantics forwarding experiment — failed / partial

Source: `08f3b245c4afee62df5a9f18e3e1a6ca4c7d2820`. One fresh iPhone 17 / iOS 26.4.1 simulator, `E94EA66C-11DC-4705-92B4-59E6502C78A5`, one XCTest launch, no retry or recovery. Synthetic auth/API fixture; no live account proof.

The real Flutter native accessibility marker was found and its ready identity validated, unlike the preserved `01bacee` readiness failure. One public XCTest coordinate drag was delivered at 2026-11-02T19:38:25Z from (4.02, 437) to (341.7, 437), normalized (0.01, 0.5) to (0.85, 0.5), with a 0.1-second press. Native event target PID 24204 matches identity `1793648302473383|24204|isolates/2527935443000647`.

The unchanged destination wait failed: no Dart OBSERVED milestone or accepted detail-to-list destination. Test duration 27.689 seconds; command exit 65 after 73.43 seconds. Accessibility exposure and actual input delivery are partial evidence only; Requests native navigation is NOT accepted. The screenshot is the ready state before input, not a destination image. No post-input successful guard/model assertion is claimed.

Build exited 0, but its wall-clock elapsed report is anomalous (3579.48 seconds despite a 600-second configured timeout). The wrapper uses subprocess wait with a monotonic deadline and time.time for reporting; the clock discrepancy's cause is unknown. Compilation success is separate from bounded wall-duration proof. See preserved command result and watchdog provenance.

Raw result bundle and automatic video remain in `/private/tmp/bundleen-n04-xcui-forwarding/Result.xcresult` and its attachments directory. Committed logs contain only selected Dart milestones, not ephemeral VM URLs. Native UI snapshot attachment does not provide a complete descendant tree; marker lookup success is the evidence of exposure.

Cleanup reconciled: task simulator absent, remaining devices shutdown, no matching prior task process. Both explicit development and staging config-only builds restored lib/main.dart successfully. Source/config exclusion found no fixture reference in production lib and only RunnerTests in normal schemes; normal artifact rebuild was not performed. Local checks: 474 tests passed, analyzer clean, formatter 67 files / zero changes.

Source-only follow-up: the pinned live test binding defaults shouldPropagateDevicePointerEvents to false and gates real device input; tester-generated events take a different path. This is a next hypothesis, not an established cause or successful fix. Further execution requires a separate exact checkpoint and authorization.
