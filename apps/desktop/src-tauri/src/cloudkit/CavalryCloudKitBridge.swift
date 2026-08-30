import Foundation

public typealias CavalryCloudKitEventCallback =
  @convention(c) (
    UnsafePointer<CChar>?
  ) -> Void

private final class CavalryCloudKitCallbackBox: @unchecked Sendable {
  private let lock = NSLock()
  private var callback: CavalryCloudKitEventCallback?

  func set(_ nextCallback: CavalryCloudKitEventCallback?) {
    lock.lock()
    callback = nextCallback
    lock.unlock()
  }

  func emit(_ payload: [String: String]) {
    guard
      let data = try? JSONSerialization.data(withJSONObject: payload),
      let json = String(data: data, encoding: .utf8)
    else { return }
    lock.lock()
    let current = callback
    lock.unlock()
    json.withCString { pointer in
      current?(pointer)
    }
  }
}

private final class CavalryCloudKitResponseBox: @unchecked Sendable {
  private let lock = NSLock()
  private var response =
    "{\"ok\":false,\"code\":\"cloudkit_bridge_failed\",\"error\":\"CloudKit did not return a response.\"}"

  func set(_ value: String) {
    lock.lock()
    response = value
    lock.unlock()
  }

  func get() -> String {
    lock.lock()
    defer { lock.unlock() }
    return response
  }
}

private let cavalryCloudKitCallbackBox = CavalryCloudKitCallbackBox()

@_cdecl("cavalry_cloudkit_set_event_callback")
public func cavalryCloudKitSetEventCallback(
  _ callback: CavalryCloudKitEventCallback?
) {
  cavalryCloudKitCallbackBox.set(callback)
  Task {
    await CavalryCloudKitStore.shared.setEventSink { payload in
      cavalryCloudKitCallbackBox.emit(payload)
    }
  }
}

@_cdecl("cavalry_cloudkit_request")
public func cavalryCloudKitRequest(
  _ rawRequest: UnsafePointer<CChar>?
) -> UnsafeMutablePointer<CChar>? {
  guard let rawRequest else { return nil }
  let request = String(cString: rawRequest)
  let responseBox = CavalryCloudKitResponseBox()
  let semaphore = DispatchSemaphore(value: 0)
  Task {
    responseBox.set(await CavalryCloudKitStore.shared.request(request))
    semaphore.signal()
  }
  semaphore.wait()

  let bytes = responseBox.get().utf8CString
  let result = UnsafeMutablePointer<CChar>.allocate(capacity: bytes.count)
  bytes.withUnsafeBufferPointer { buffer in
    if let source = buffer.baseAddress {
      result.initialize(from: source, count: buffer.count)
    }
  }
  return result
}

@_cdecl("cavalry_cloudkit_free_string")
public func cavalryCloudKitFreeString(_ pointer: UnsafeMutablePointer<CChar>?) {
  pointer?.deallocate()
}
