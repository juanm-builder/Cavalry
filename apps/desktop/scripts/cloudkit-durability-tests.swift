import Foundation

private enum InjectedFailure: Error { case diskFull }

@main
struct CloudKitDurabilityTests {
  static func assertData(_ url: URL, equals expected: Data) throws {
    let actual = try Data(contentsOf: url)
    precondition(actual == expected, "Manifest contents changed unexpectedly")
  }

  static func verifyOwnerIsolation(root: URL) throws {
    let legacy = root.appendingPathComponent("legacy", isDirectory: true)
    let source = legacy.appendingPathComponent("payloads", isDirectory: true)
    try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
    let ownerA = "_owner-a"
    let ownerB = "_owner-b"
    let payloadA = Data("unsent edit belonging only to A".utf8)
    let payloadB = Data("unsent edit belonging only to B".utf8)
    // Deliberately use the same filename, as older builds could do.
    let filename = "pending-workbook.html"
    try payloadA.write(to: source.appendingPathComponent(filename))
    let manifestA = try JSONSerialization.data(withJSONObject: [
      "accountRecordName": ownerA,
      "pending": ["workbook": ["payloadFile": filename]],
      "pendingDeletes": ["delete-only-in-a"]
    ], options: [.sortedKeys])
    let originalManifest = legacy.appendingPathComponent("sync-state.json")
    try manifestA.write(to: originalManifest)
    let targetA = CavalryCloudKitOwnerFiles.directory(root: root, ownerId: ownerA)
    let targetB = CavalryCloudKitOwnerFiles.directory(root: root, ownerId: ownerB)
    precondition(targetA != targetB)

    for failOn in [filename, "sync-state.json"] {
      do {
        try CavalryCloudKitOwnerFiles.create(
          directory: targetA, ownerId: ownerA, data: manifestA,
          payloadFiles: [filename], sourcePayloads: source,
          writeData: { data, url in
            if url.lastPathComponent == failOn { throw InjectedFailure.diskFull }
            try data.write(to: url, options: [.atomic])
          }
        )
        fatalError("Expected migration failure")
      } catch InjectedFailure.diskFull {}
      precondition(!FileManager.default.fileExists(atPath: targetA.path))
      try assertData(originalManifest, equals: manifestA)
      try assertData(source.appendingPathComponent(filename), equals: payloadA)
    }
    // A successful return also requires the written bytes to be verified.
    do {
      try CavalryCloudKitOwnerFiles.create(
        directory: targetA, ownerId: ownerA, data: manifestA,
        payloadFiles: [filename], sourcePayloads: source,
        writeData: { _, url in try Data("damaged".utf8).write(to: url) }
      )
      fatalError("Expected corrupted-copy failure")
    } catch CavalryCloudKitOwnerFiles.StorageError.invalidPayload {}
    precondition(!FileManager.default.fileExists(atPath: targetA.path))

    try CavalryCloudKitOwnerFiles.create(
      directory: targetA, ownerId: ownerA, data: manifestA,
      payloadFiles: [filename], sourcePayloads: source
    )
    try payloadB.write(to: source.appendingPathComponent(filename))
    let manifestB = try JSONSerialization.data(withJSONObject: [
      "accountRecordName": ownerB,
      "pending": ["workbook": ["payloadFile": filename]],
      "pendingDeletes": ["delete-only-in-b"]
    ], options: [.sortedKeys])
    try CavalryCloudKitOwnerFiles.create(
      directory: targetB, ownerId: ownerB, data: manifestB,
      payloadFiles: [filename], sourcePayloads: source
    )
    let a = try CavalryCloudKitOwnerFiles.read(directory: targetA, ownerId: ownerA) { _ in }
    let b = try CavalryCloudKitOwnerFiles.read(directory: targetB, ownerId: ownerB) { _ in }
    precondition(a == manifestA, "Returning to A lost pending uploads or deletes")
    precondition(b == manifestB, "B received another owner's queued changes")
    try assertData(targetA.appendingPathComponent("payloads/\(filename)"), equals: payloadA)
    try assertData(targetB.appendingPathComponent("payloads/\(filename)"), equals: payloadB)
    do {
      _ = try CavalryCloudKitOwnerFiles.read(directory: targetA, ownerId: ownerB) { _ in }
      fatalError("Expected wrong-owner rejection")
    } catch CavalryCloudKitOwnerFiles.StorageError.invalidOwner {}
    do {
      try CavalryCloudKitOwnerFiles.create(
        directory: targetA, ownerId: ownerA, data: manifestA,
        payloadFiles: [filename], sourcePayloads: source
      )
      fatalError("Expected existing account to remain untouched")
    } catch CavalryCloudKitOwnerFiles.StorageError.existingDestination {}
    try assertData(targetA.appendingPathComponent("payloads/\(filename)"), equals: payloadA)

    let primaryA = targetA.appendingPathComponent("sync-state.json")
    try manifestA.write(to: primaryA.appendingPathExtension("previous"))
    try Data("corrupt primary".utf8).write(to: primaryA)
    let recovered = try CavalryCloudKitOwnerFiles.read(directory: targetA, ownerId: ownerA) { _ in }
    precondition(recovered == manifestA)
    let retained = try FileManager.default.contentsOfDirectory(atPath: targetA.path)
    precondition(retained.contains { $0.hasPrefix("sync-state.json.unreadable-") })
    try manifestB.write(to: primaryA.appendingPathExtension("previous"))
    do {
      _ = try CavalryCloudKitOwnerFiles.read(directory: targetA, ownerId: ownerA) { _ in }
      fatalError("Wrong-owner backup must not become recovery")
    } catch {}
    let incomplete = CavalryCloudKitOwnerFiles.directory(root: root, ownerId: "incomplete")
    try FileManager.default.createDirectory(at: incomplete, withIntermediateDirectories: true)
    do {
      _ = try CavalryCloudKitOwnerFiles.read(directory: incomplete, ownerId: "incomplete") { _ in }
      fatalError("Incomplete account storage must not become a blank library")
    } catch CavalryCloudKitOwnerFiles.StorageError.invalidManifest {}
    print("PASS: A/B/A storage isolates pending uploads, deletes, and colliding filenames; migration failures preserve originals; corrupt and wrong-owner stores fail closed")
  }

  static func main() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("cavalry-durability-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let payloads = root.appendingPathComponent("payloads", isDirectory: true)
    let manifest = root.appendingPathComponent("sync-state.json")
    let backup = manifest.appendingPathExtension("previous")
    try FileManager.default.createDirectory(at: payloads, withIntermediateDirectories: true)
    let old = Data("first committed manifest".utf8)
    let next = Data("second committed manifest".utf8)
    try old.write(to: manifest, options: .atomic)
    try Data("original workbook".utf8).write(to: payloads.appendingPathComponent("old.html"))
    try Data("new workbook".utf8).write(to: payloads.appendingPathComponent("next.html"))
    var retired: Set<String> = ["old.html"]

    // Fail after the recovery manifest commits but before the primary commit.
    do {
      try CavalryCloudKitStateFile.commit(
        data: next, previousData: old, stateURL: manifest, payloadsURL: payloads,
        retainedFiles: ["old.html", "next.html"], retiredFiles: &retired,
        writeData: { data, url in
          if url == manifest { throw InjectedFailure.diskFull }
          try data.write(to: url, options: .atomic)
        }
      )
      fatalError("Expected injected write failure")
    } catch InjectedFailure.diskFull {}
    try assertData(manifest, equals: old)
    try assertData(backup, equals: old)
    precondition(FileManager.default.fileExists(atPath: payloads.appendingPathComponent("old.html").path), "Failed commit deleted the old workbook")
    precondition(retired.contains("old.html"), "Failed commit consumed retirement queue")

    try CavalryCloudKitStateFile.commit(
      data: next, previousData: old, stateURL: manifest, payloadsURL: payloads,
      retainedFiles: ["old.html", "next.html"], retiredFiles: &retired
    )
    try assertData(manifest, equals: next)
    try assertData(backup, equals: old)
    precondition(FileManager.default.fileExists(atPath: payloads.appendingPathComponent("old.html").path), "Prior manifest's workbook was deleted")

    // Only a later successful commit, with neither manifest referencing the
    // old payload, is allowed to retire it.
    try CavalryCloudKitStateFile.commit(
      data: next, previousData: next, stateURL: manifest, payloadsURL: payloads,
      retainedFiles: ["next.html"], retiredFiles: &retired
    )
    precondition(!FileManager.default.fileExists(atPath: payloads.appendingPathComponent("old.html").path))
    precondition(FileManager.default.fileExists(atPath: payloads.appendingPathComponent("next.html").path))
    precondition(retired.isEmpty)
    try verifyOwnerIsolation(root: root)
    print("PASS: failed manifest commit preserves workbooks; recovery payloads survive until safely retired")
  }
}
