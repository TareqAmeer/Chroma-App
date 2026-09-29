// Prints the CGWindowID of the largest on-screen window owned by the given app name,
// for use with `screencapture -l <id>` — a composited, off-screen-buffer capture that
// works regardless of focus/occlusion, unlike `-R <region>` which grabs whatever's
// visible at those screen coordinates. Verified empirically (diagnostics/README.md):
// a captured Finder window at 920x492 points came back 1840x984px, exactly matching
// its real bounds at 2x retina scale — this is NOT a full-screen capture in disguise.
//
// No CGWindowID API is exposed via AppleScript/System Events (its "id" property errors
// on a real window), and pyobjc's Quartz bindings need Python 3.9+ (this machine's
// system python3 is 3.8) — a `swift` one-liner needs neither, since Xcode command line
// tools already ship it.
import CoreGraphics
import Foundation

// `swift script.swift arg` does NOT hand CommandLine.arguments a clean
// [scriptPath, arg] array the way a compiled binary would — verified live: it's
// the full swift-frontend invocation (-frontend -interpret <path> -sdk ... --
// arg), with our actual argument buried after a `--` separator. Find it there
// instead of assuming index 1 (which silently grabbed "-frontend" instead).
guard let sepIndex = CommandLine.arguments.firstIndex(of: "--"),
      sepIndex + 1 < CommandLine.arguments.count else {
    FileHandle.standardError.write("usage: find_window.swift <owner name>\n".data(using: .utf8)!)
    exit(1)
}
let ownerName = CommandLine.arguments[sepIndex + 1]
let options = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
guard let windowListInfo = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: AnyObject]] else {
    exit(1)
}
var best: (id: Int, area: CGFloat)? = nil
for window in windowListInfo {
    guard let owner = window[kCGWindowOwnerName as String] as? String,
          owner.caseInsensitiveCompare(ownerName) == .orderedSame else { continue }
    guard let windowID = window[kCGWindowNumber as String] as? Int else { continue }
    let bounds = window[kCGWindowBounds as String] as? [String: CGFloat]
    let area = (bounds?["Width"] ?? 0) * (bounds?["Height"] ?? 0)
    if best == nil || area > best!.area {
        best = (windowID, area)
    }
}
if let b = best {
    print(b.id)
} else {
    exit(1)
}
