let primary = NSRect(x: 0, y: 0, width: 2560, height: 1410)
let secondary = NSRect(x: -1440, y: 0, width: 1440, height: 876)
let oldDisplayFrame = NSRect(x: 0, y: 0, width: 3600, height: 2188)
let normal = NSRect(x: -1380, y: 70, width: 1050, height: 720)
let acrossDisplays = NSRect(x: -640, y: 10, width: 1720, height: 780)
let clipped = NSRect(x: -40, y: -45, width: 1100, height: 720)
let smallScreen = NSRect(x: 0, y: 0, width: 1024, height: 660)

precondition(fittedCavalryWindowFrame(oldDisplayFrame, workArea: primary, visibleAreas: [primary]) == primary)
precondition(fittedCavalryWindowFrame(normal, workArea: secondary, visibleAreas: [primary, secondary]) == normal)
precondition(fittedCavalryWindowFrame(acrossDisplays, workArea: primary, visibleAreas: [primary, secondary]) == acrossDisplays)
precondition(fittedCavalryWindowFrame(normal, workArea: primary, visibleAreas: [primary]) == NSRect(x: 0, y: 70, width: 1050, height: 720))
precondition(fittedCavalryWindowFrame(clipped, workArea: primary, visibleAreas: [primary]) == NSRect(origin: .zero, size: clipped.size))
precondition(fittedCavalryWindowFrame(oldDisplayFrame, workArea: smallScreen, visibleAreas: [smallScreen]) == smallScreen)

// Exercise a real offscreen test window and the Cocoa notification used on display reconfiguration.
MainActor.assumeIsolated {
    let application = NSApplication.shared
    if let screen = NSScreen.main {
        let area = screen.visibleFrame
        let window = NSWindow(contentRect: area, styleMask: [.titled, .resizable], backing: .buffered, defer: false)
        let oversized = NSRect(origin: area.origin, size: NSSize(width: area.width * 3, height: area.height * 3))
        window.minSize = oversized.size
        window.setFrame(oversized, display: false)
        cavalryInstallWindowBounds(Unmanaged.passUnretained(window).toOpaque())
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
        precondition(window.frame == area, "Restored frame was not fitted: \(window.frame)")
        precondition(window.minSize == area.size, "Native minimum must fit the screen.")
        window.setFrame(oversized, display: false)
        NotificationCenter.default.post(name: NSApplication.didChangeScreenParametersNotification, object: application)
        RunLoop.main.run(until: Date(timeIntervalSinceNow: 0.05))
        precondition(window.frame == area, "Display change left the window too wide.")
    }
}
