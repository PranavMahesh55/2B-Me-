import Foundation
import CoreGraphics

// Keyboard timing without Accessibility.
//
// DEFAULT_PRIVACY in backend/app/main.py has had `keyboard_timing: True` all
// along, but nothing collected it: the macOS collector only reads the frontmost
// application name. An event tap would close that gap and would also require
// Accessibility permission and expose key CONTENT, which backend/README.md
// promises never to accept.
//
// CGEventSource.counterForEventType is not a tap. It returns a monotonic count
// of events since boot, so differences between samples give a rate and nothing
// else -- no keycodes, no characters, no target application. It prompts for no
// permission at all.

func counter(_ type: CGEventType) -> Int {
    Int(CGEventSource.counterForEventType(.hidSystemState, eventType: type))
}

// kCGAnyInputEventType
let anyInput = CGEventType(rawValue: ~0)!
let idle = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: anyInput)

let payload: [String: Any] = [
    "keys": counter(.keyDown),
    "clicks": counter(.leftMouseDown) + counter(.rightMouseDown),
    "scrolls": counter(.scrollWheel),
    "idle_s": (idle * 10).rounded() / 10,
    "at": Date().timeIntervalSince1970,
]

let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
print(String(decoding: data, as: UTF8.self))
