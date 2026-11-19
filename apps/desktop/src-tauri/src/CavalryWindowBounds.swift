import AppKit

/// AppKit reports both window frames and screen work areas in one coordinate space (points).
func fittedCavalryWindowFrame(_ frame: NSRect, workArea: NSRect, visibleAreas: [NSRect]) -> NSRect {
    guard !frame.isEmpty, !workArea.isEmpty else { return frame }
    if visibleAreas.contains(where: { $0.contains(frame) }) { return frame }
    if visibleAreas.count > 1 {
        // A window can deliberately span adjacent displays without being clipped.
        let visible = CGMutablePath()
        for area in visibleAreas { visible.addRect(area) }
        if CGPath(rect: frame, transform: nil).subtracting(visible, using: .winding).isEmpty {
            return frame
        }
    }
    let width = min(frame.width, workArea.width)
    let height = min(frame.height, workArea.height)
    let x = min(max(frame.minX, workArea.minX), workArea.maxX - width)
    let top = min(max(frame.maxY, workArea.minY + height), workArea.maxY)
    return NSRect(x: x, y: top - height, width: width, height: height)
}

@MainActor
private final class CavalryWindowBounds: NSObject {
    private weak var window: NSWindow?
    private let minimum: NSSize
    private static var installed: CavalryWindowBounds?

    static func install(on window: NSWindow) {
        installed = CavalryWindowBounds(window)
    }

    private init(_ window: NSWindow) {
        self.window = window
        self.minimum = window.minSize
        super.init()
        let center = NotificationCenter.default
        center.addObserver(self, selector: #selector(scheduleFit), name: NSApplication.didChangeScreenParametersNotification, object: nil)
        center.addObserver(self, selector: #selector(scheduleFit), name: NSWindow.didBecomeKeyNotification, object: window)
        center.addObserver(self, selector: #selector(scheduleFit), name: NSWindow.didExitFullScreenNotification, object: window)
        scheduleFit()
    }

    @objc private func scheduleFit() {
        // Let AppKit finish applying restored geometry and any native display reconfiguration.
        DispatchQueue.main.async { [weak self] in self?.fit() }
    }

    private func fit() {
        guard let window, !window.isMiniaturized, !window.styleMask.contains(.fullScreen),
              let screen = window.screen ?? NSScreen.main else { return }
        let available = screen.visibleFrame
        guard !available.isEmpty else { return }
        let allowedMinimum = NSSize(width: min(minimum.width, available.width), height: min(minimum.height, available.height))
        if window.minSize != allowedMinimum { window.minSize = allowedMinimum }
        let frame = fittedCavalryWindowFrame(window.frame, workArea: available, visibleAreas: NSScreen.screens.map(\.visibleFrame))
        if window.frame != frame { window.setFrame(frame, display: true, animate: false) }
    }
}

@_cdecl("cavalry_install_window_bounds")
@MainActor
public func cavalryInstallWindowBounds(_ rawWindow: UnsafeMutableRawPointer) {
    CavalryWindowBounds.install(on: Unmanaged<NSWindow>.fromOpaque(rawWindow).takeUnretainedValue())
}
