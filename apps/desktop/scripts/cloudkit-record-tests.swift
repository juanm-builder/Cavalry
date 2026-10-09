import CloudKit
import CryptoKit
import Foundation

private let cavalryRecordType = "CavalryWorkbook"
private let maximumPayloadBytes = 25 * 1024 * 1024
private let maximumConflictReportBytes = 128 * 1024
private enum CloudStoreError: Error { case invalidPayload }
private struct CloudKitStoredIssue: Codable {
  let code: String
  let message: String
  let details: String?
  let retryable: Bool
  let operation: String
  let workbookId: String?
}
// INSERT_PRODUCTION_MODELS
// INSERT_PRODUCTION_HELPERS

private struct TestDiskState: Codable {
  var syncState: Data? = Data("consumed token".utf8)
  var pending: [String: PendingWorkbook] = [:]
  var remote: [String: RemoteWorkbook] = [:]
  var conflicts: [String: WorkbookConflict] = [:]
  var pendingConflictNotices: [String: PendingConflictNoticeUpdate]?
  var rejectedConflictNotices: [String: String]?
  var rejectedConflictNoticeCodes: [String: String]?
  var rejectedConflictNoticeDetails: [String: String]?
  var lastErrorCode: String?
  var lastErrorDetails: String?
  var lastErrorRetryable: Bool?
  var lastErrorOperation: String?
  var lastErrorWorkbookId: String?
  var storedIssue: CloudKitStoredIssue? {
    get {
      guard let code = lastErrorCode, let message = lastError, let operation = lastErrorOperation else { return nil }
      return CloudKitStoredIssue(code: code, message: message, details: lastErrorDetails, retryable: lastErrorRetryable ?? false, operation: operation, workbookId: lastErrorWorkbookId)
    }
    set {
      lastErrorCode = newValue?.code
      lastError = newValue?.message
      lastErrorDetails = newValue?.details
      lastErrorRetryable = newValue?.retryable
      lastErrorOperation = newValue?.operation
      lastErrorWorkbookId = newValue?.workbookId
    }
  }
  var recordRecovery: CavalryCloudKitRecordRecovery?
  var lastError: String?
}

private struct TestSaveFailure { let record: CKRecord }
private final class TestSyncEngine {
  enum Change: Hashable { case saveRecord(CKRecord.ID) }
  final class State {
    var pending: Set<Change> = []
    func add(pendingRecordZoneChanges changes: [Change]) { pending.formUnion(changes) }
    func remove(pendingRecordZoneChanges changes: [Change]) { pending.subtract(changes) }
  }
  let state = State()
}
private final class TestDatabase {
  var fetch: ([CKRecord.ID]) async throws -> [CKRecord.ID: Result<CKRecord, Error>] = { _ in [:] }
  var calls = 0
  func records(for ids: [CKRecord.ID]) async throws -> [CKRecord.ID: Result<CKRecord, Error>] {
    calls += 1
    return try await fetch(ids)
  }
}
private struct TestContainer { let privateCloudDatabase = TestDatabase() }
private struct TestFailure { let code: String?; let error: String?; let details: String? }
private func cloudFailure(_ error: Error, fallbackCode: String, cloudEnvironment: String) -> TestFailure {
  TestFailure(code: "cloudkit_request_failed", error: "Temporary iCloud read failure", details: nil)
}
private func isRetryableCloudError(_ error: Error) -> Bool { (error as? CKError)?.code == .networkFailure }
private final class UndownloadedAsset: CKAsset, @unchecked Sendable {
  override var fileURL: URL? { nil }
}

// Only account/network and the application manifest commit are simulated. The
// production decoder, validation, recovery transitions and real CKRecord value
// types execute unchanged. No CKContainer or user account is initialized.
private final class TestStore {
  var diskState = TestDiskState()
  var fetchCycleHadError = false
  var commits = 0
  var engine: TestSyncEngine? = TestSyncEngine()
  var ownerEpoch = 1
  var syncEnabled = true
  let cloudEnvironment = "Production"
  let container = TestContainer()
  var events: [String] = []
  var retiredPayloadFiles: Set<String> = []
  let directory: URL
  init(_ directory: URL) throws {
    self.directory = directory
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }
  func payloadURL(_ fileName: String) -> URL { directory.appendingPathComponent(fileName) }
  func persist() throws { commits += 1 }
  func setStoredIssue(code: String, message: String, details: String?, retryable: Bool, operation: String, workbookId: String?) {
    diskState.storedIssue = CloudKitStoredIssue(code: code, message: message, details: details, retryable: retryable, operation: operation, workbookId: workbookId)
    diskState.lastError = message
    try! persist()
  }
  func setLastError(message: String, code: String, details: String, retryable: Bool, operation: String, workbookId: String? = nil) {
    setStoredIssue(code: code, message: message, details: details, retryable: retryable, operation: operation, workbookId: workbookId)
  }
  func setLastError(_ error: Error, fallbackCode: String, operation: String, workbookId: String? = nil, itemID: AnyHashable? = nil) {
    setStoredIssue(code: fallbackCode, message: fallbackCode == "cloud_snapshot_invalid" ? "The iCloud workbook failed its integrity check." : "Temporary iCloud read failure", details: nil, retryable: (error as? CKError)?.code == .networkFailure, operation: operation, workbookId: workbookId)
  }
  func recordID(_ name: String) -> CKRecord.ID { CKRecord.ID(recordName: name, zoneID: CKRecordZone.ID(zoneName: "CavalryWorkbooksV1")) }
  func replaceRemote(recordName: String, with remote: RemoteWorkbook) { diskState.remote[recordName] = remote }
  func acknowledgeConflictNoticeIfMatched(recordName: String, metadata: CloudWorkbookMetadata) {}
  func removePendingPayload(recordName: String) { if let file = diskState.pending[recordName]?.payloadFile { retiredPayloadFiles.insert(file) } }
  func removePendingConflictPackage(recordName: String) {}
  func removeRemotePayload(recordName: String) {}
  func emit(reason: String, workbookId: String? = nil) { events.append(reason) }
  func processCollision(_ failure: TestSaveFailure, syncEngine: TestSyncEngine) async -> Bool {
    let recordName = failure.record.recordID.recordName
    let workbookId = diskState.pending[recordName]?.metadata.id ?? diskState.remote[recordName]?.metadata.id
    // INSERT_PRODUCTION_COLLISION
  }
  // INSERT_PRODUCTION_METHODS
}

private let workbookID = "native-contract-workbook"
private let html = Data("<html><body>Contract fixture ₱123.45</body></html>".utf8)
private let expectedHash = "6af2b907e8840df35e32955f840b960a0bca3c3d458522480c43cb62756692a7"
private let expectedName = "workbook_f672dffe029c75ed302418c34a27a05c090ac020622ce15cc83eb8e20abb07dd"

@main
private enum RecordTests {
  static func record(_ root: URL, time: String = "2026-09-06T04:00:00.000Z", name: String = expectedName) throws -> CKRecord {
    let record = CKRecord(recordType: "CavalryWorkbook", recordID: CKRecord.ID(recordName: name, zoneID: CKRecordZone.ID(zoneName: "CavalryWorkbooksV1")))
    // Independent fixture shared with the desktop Web Services contract tests.
    // Native stores and Web Services STRING/INT64 isEncrypted values use these
    // exact logical CKRecord representations. Asset bytes never enter a field.
    record["schemaVersion"] = NSNumber(value: 1)
    record.encryptedValues["workbookId"] = workbookID as CKRecordValue
    record.encryptedValues["name"] = "Contract fixture" as CKRecordValue
    record.encryptedValues["currency"] = "PHP" as CKRecordValue
    record.encryptedValues["revision"] = NSNumber(value: 7)
    record.encryptedValues["sourceUpdatedAt"] = time as CKRecordValue
    record.encryptedValues["payloadHash"] = expectedHash as CKRecordValue
    let asset = root.appendingPathComponent("asset-\(UUID().uuidString).html")
    try html.write(to: asset)
    record["payloadAsset"] = CKAsset(fileURL: asset)
    return record
  }

  static func verifyCollisions(_ root: URL) async throws {
    func queuedStore(_ suffix: String) throws -> TestStore {
      let store = try TestStore(root.appendingPathComponent(suffix))
      try store.prepareRecordRecovery()
      let baseline = try record(root)
      guard let remote = store.decodeRemoteRecord(baseline) else { fatalError("Fixture failed") }
      store.diskState.remote[expectedName] = remote
      let local = Data("my newer local edit".utf8)
      try local.write(to: store.payloadURL("pending.html"))
      let metadata = CloudWorkbookMetadata(id: workbookID, name: "Pending", year: nil, currency: "PHP", revision: 8, updatedAt: "2026-09-06T04:00:00Z")
      store.diskState.pending[expectedName] = PendingWorkbook(metadata: metadata, payloadFile: "pending.html", payloadHash: sha256(local), expectedRevision: 7)
      store.engine!.state.add(pendingRecordZoneChanges: [.saveRecord(baseline.recordID)])
      return store
    }
    let stub = try record(root)
    stub["payloadAsset"] = UndownloadedAsset(fileURL: root.appendingPathComponent("not-downloaded"))
    precondition((stub["payloadAsset"] as? CKAsset)?.fileURL == nil)
    let store = try queuedStore("collision")
    let full = try record(root)
    store.container.privateCloudDatabase.fetch = { ids in [ids[0]: .success(full)] }
    _ = await store.processCollision(TestSaveFailure(record: stub), syncEngine: store.engine!)
    precondition(store.container.privateCloudDatabase.calls == 1)
    precondition(store.diskState.pending[expectedName]?.recordChangeRetryCount == 1)
    precondition(store.engine!.state.pending.contains(.saveRecord(stub.recordID)))
    precondition(store.diskState.storedIssue == nil && store.diskState.conflicts.isEmpty)
    precondition(store.diskState.remote[expectedName]?.systemFields == encodeSystemFields(full))
    precondition(try! Data(contentsOf: store.payloadURL("pending.html")) == Data("my newer local edit".utf8))

    _ = await store.processCollision(TestSaveFailure(record: stub), syncEngine: store.engine!)
    precondition(store.diskState.conflicts[expectedName]?.remoteRevision == 7)
    precondition(!store.engine!.state.pending.contains(.saveRecord(stub.recordID)), "Repeated tag-only collision retried without a bound")

    let advanced = try queuedStore("advanced")
    let winner = try record(root)
    winner.encryptedValues["revision"] = NSNumber(value: 9)
    advanced.container.privateCloudDatabase.fetch = { ids in [ids[0]: .success(winner)] }
    _ = await advanced.processCollision(TestSaveFailure(record: stub), syncEngine: advanced.engine!)
    precondition(advanced.diskState.remote[expectedName]?.metadata.revision == 9)
    precondition(advanced.diskState.conflicts[expectedName]?.remoteRevision == 9)
    precondition(advanced.diskState.storedIssue == nil)
    precondition(try! Data(contentsOf: advanced.payloadURL("pending.html")) == Data("my newer local edit".utf8))

    let offline = try queuedStore("offline")
    offline.container.privateCloudDatabase.fetch = { _ in throw CKError(.networkFailure) }
    _ = await offline.processCollision(TestSaveFailure(record: stub), syncEngine: offline.engine!)
    precondition(offline.diskState.pending[expectedName]?.recordChangeRetryCount == nil)
    precondition(offline.diskState.conflicts.isEmpty && !offline.engine!.state.pending.contains(.saveRecord(stub.recordID)))
    precondition(offline.diskState.recordRecovery?.rejectedRecordNames.contains(expectedName) == true)
    precondition(offline.diskState.recordRecovery?.reserveRetry(at: Date()).isEmpty == true, "Cooldown lost")
    precondition(try! Data(contentsOf: offline.payloadURL("pending.html")) == Data("my newer local edit".utf8))
    _ = offline.applyFetchedRecord(full)
    precondition(offline.engine!.state.pending.contains(.saveRecord(stub.recordID)), "Incremental recovery did not restore the suspended upload")
    precondition(offline.diskState.recordRecovery?.rejectedRecordNames.isEmpty == true)

    let switched = try queuedStore("switched")
    let previousEngine = switched.engine!
    switched.container.privateCloudDatabase.fetch = { ids in
      switched.ownerEpoch += 1
      switched.engine = TestSyncEngine()
      return [ids[0]: .success(full)]
    }
    _ = await switched.processCollision(TestSaveFailure(record: stub), syncEngine: previousEngine)
    precondition(switched.diskState.pending[expectedName]?.recordChangeRetryCount == nil)
    precondition(switched.diskState.storedIssue == nil && switched.diskState.conflicts.isEmpty)
    precondition(switched.engine!.state.pending.isEmpty, "Stale callback wrote into the new owner's queue")
    let retry = try queuedStore("targeted")
    retry.rejectRemoteRecord(expectedName)
    retry.engine!.state.pending.removeAll()
    let due = Date().addingTimeInterval(61)
    precondition(retry.diskState.recordRecovery?.reserveRetry(at: Date()).isEmpty == true)
    precondition(retry.diskState.recordRecovery?.reserveRetry(at: due) == [expectedName])
    precondition(retry.diskState.recordRecovery?.reserveRetry(at: due).isEmpty == true)
    retry.container.privateCloudDatabase.fetch = { ids in [ids[0]: .success(full)] }
    try await retry.retryRejectedRemoteRecords([expectedName], syncEngine: retry.engine!, operationEpoch: retry.ownerEpoch)
    precondition(retry.engine!.state.pending.contains(.saveRecord(stub.recordID)))
    precondition(retry.diskState.pending[expectedName] != nil && retry.diskState.recordRecovery?.rejectedRecordNames.isEmpty == true)

    for hydration in [false, true] {
      let deleted = try queuedStore("deleted-\(hydration)")
      deleted.rejectRemoteRecord(expectedName)
      deleted.container.privateCloudDatabase.fetch = { ids in [ids[0]: .failure(CKError(.unknownItem))] }
      if hydration {
        _ = await deleted.processCollision(TestSaveFailure(record: stub), syncEngine: deleted.engine!)
      } else {
        try await deleted.retryRejectedRemoteRecords([expectedName], syncEngine: deleted.engine!, operationEpoch: deleted.ownerEpoch)
      }
      precondition(deleted.diskState.conflicts[expectedName]?.remoteDeleted == true)
      precondition(deleted.diskState.recordRecovery?.rejectedRecordNames.isEmpty == true)
      precondition(deleted.events.filter { $0 == "deleted" }.count == 1, "Confirmed deletion must be announced exactly once")
      precondition(try! Data(contentsOf: deleted.payloadURL("pending.html")) == Data("my newer local edit".utf8))
    }
    print("PASS: assetless CloudKit collision hydrates before CAS, bounded same-revision retry, true conflict, offline preservation, incremental/targeted recovery, cooldown, deletion events and stale-owner isolation")
  }

  static func main() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("cavalry-record-tests-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try TestStore(root)
    try store.prepareRecordRecovery()
    precondition(store.diskState.syncState != nil, "Healthy migration must retain the incremental token")
    precondition(hashedRecordName(workbookID) == expectedName && sha256(html) == expectedHash)
    for time in ["2026-09-06T04:00:00.000Z", "2026-09-06T04:00:00Z", "2026-09-06T12:00:00+08:00", "2026-09-06", "2026-09-06 04:00:00Z", "2026-09-06 12:00:00.123+08:00"] {
      guard let remote = store.decodeRemoteRecord(try record(root, time: time)) else { fatalError("Rejected valid native/web date \(time)") }
      precondition(remote.metadata.id == workbookID && remote.metadata.revision == 7)
      precondition(try! Data(contentsOf: store.payloadURL(remote.payloadFile)) == html)
    }
    for time in ["", "not a date", "2026-02-30", "09/06/2026", "2026-09-06T04:00:00"] {
      precondition(store.decodeRemoteRecord(try! record(root, time: time)) == nil, "Accepted ambiguous/invalid date \(time)")
      precondition(store.diskState.storedIssue?.details?.contains("sourceUpdatedAt") == true)
    }
    let fields = ["workbookId", "name", "currency", "revision", "sourceUpdatedAt", "payloadHash"]
    for key in fields {
      let fixture = try record(root)
      fixture.encryptedValues[key] = nil
      precondition(store.decodeRemoteRecord(fixture) == nil)
      precondition(store.diskState.storedIssue?.details?.contains(key + "[encrypted:missing") == true)
      precondition(store.diskState.recordRecovery?.rejectedRecordNames.contains(expectedName) == true)
    }
    let plaintext = try record(root)
    plaintext.encryptedValues["workbookId"] = nil
    plaintext["workbookId"] = workbookID as CKRecordValue
    precondition(store.decodeRemoteRecord(plaintext) == nil, "Plaintext must not bypass the encrypted schema")
    precondition(store.diskState.storedIssue?.details?.contains("workbookId[encrypted:missing,standard:String]") == true)
    precondition(store.diskState.storedIssue?.details?.contains(workbookID) == false, "Diagnostics leaked a workbook value")
    let wrongIdentity = try record(root, name: "workbook_wrong")
    precondition(store.decodeRemoteRecord(wrongIdentity) == nil)
    precondition(store.diskState.storedIssue?.details?.contains("identity mismatch") == true)
    let badHash = try record(root)
    badHash.encryptedValues["payloadHash"] = String(repeating: "0", count: 64) as CKRecordValue
    precondition(store.decodeRemoteRecord(badHash) == nil, "Corrupt content must not enter the local cache")
    let noAsset = try record(root)
    noAsset["payloadAsset"] = nil
    precondition(store.decodeRemoteRecord(noAsset) == nil)
    precondition(store.diskState.storedIssue?.details?.contains("payloadAsset[missing]") == true)
    // Every rejected record remains addressable after the consumed delta token
    // and process restart. Validating one must not dismiss another's failure.
    let encoded = try JSONEncoder().encode(store.diskState)
    let reopened = try TestStore(root.appendingPathComponent("reopened"))
    reopened.diskState = try JSONDecoder().decode(TestDiskState.self, from: encoded)
    precondition(reopened.diskState.recordRecovery?.rejectedRecordNames == [expectedName, "workbook_wrong"])
    _ = reopened.decodeRemoteRecord(try record(root))
    precondition(reopened.diskState.storedIssue != nil)
    reopened.resolveRejectedRemoteRecord("workbook_wrong")
    precondition(reopened.diskState.storedIssue == nil, "Successful targeted recovery must clear the snapshot error")
    print("PASS: native/Web Services record fixtures, timestamps, encrypted metadata, identity/hash/asset rejection, private diagnostics, restart-safe rejected IDs")

    // Upgrade from a legacy unscoped error: reset only the opaque token once.
    let legacy = try TestStore(root.appendingPathComponent("legacy"))
    legacy.diskState.storedIssue = CloudKitStoredIssue(code: "cloud_snapshot_invalid", message: "An iCloud workbook was malformed and was not opened. Local workbooks are unchanged.", details: nil, retryable: false, operation: "refresh", workbookId: nil)
    let savedLocal = legacy.payloadURL("local-pending.html")
    try html.write(to: savedLocal)
    let metadata = CloudWorkbookMetadata(id: workbookID, name: "Preserved local", year: nil, currency: "PHP", revision: 8, updatedAt: "2026-09-06T04:00:00Z")
    legacy.diskState.pending[expectedName] = PendingWorkbook(metadata: metadata, payloadFile: "local-pending.html", payloadHash: expectedHash, expectedRevision: 7)
    try legacy.prepareRecordRecovery()
    precondition(legacy.diskState.syncState == nil && legacy.diskState.recordRecovery?.needsFullRefetch == true)
    precondition(legacy.diskState.pending[expectedName]?.expectedRevision == 7)
    precondition(try! Data(contentsOf: savedLocal) == html)
    precondition(legacy.diskState.storedIssue != nil)
    legacy.diskState.syncState = Data("new token".utf8)
    try legacy.prepareRecordRecovery()
    precondition(legacy.diskState.syncState != nil, "Recovery migration repeated")
    legacy.fetchCycleHadError = true
    legacy.completeRecordRecoveryFetch()
    precondition(legacy.diskState.recordRecovery?.needsFullRefetch == true && legacy.diskState.storedIssue != nil)
    legacy.fetchCycleHadError = false
    _ = legacy.decodeRemoteRecord(try record(root))
    precondition(legacy.diskState.storedIssue != nil, "Legacy unscoped error cleared before the complete fetch")
    legacy.completeRecordRecoveryFetch()
    precondition(legacy.diskState.recordRecovery?.needsFullRefetch == false && legacy.diskState.storedIssue == nil)
    precondition(legacy.diskState.pending[expectedName]?.expectedRevision == 7)
    precondition(try! Data(contentsOf: savedLocal) == html)
    print("PASS: legacy one-time full refetch retains pending data and only clears errors after a complete successful scan")
    legacy.diskState.storedIssue = CloudKitStoredIssue(code: "cloud_snapshot_invalid", message: "An iCloud workbook was malformed and was not opened. Local workbooks are unchanged.", details: nil, retryable: false, operation: "upload", workbookId: workbookID)
    legacy.diskState.recordRecovery = nil
    try legacy.prepareRecordRecovery()
    legacy.completeRecordRecoveryFetch()
    precondition(legacy.diskState.storedIssue == nil, "Legacy collision upload error remained stuck")
    legacy.diskState.storedIssue = CloudKitStoredIssue(code: "cloud_snapshot_invalid", message: "A pending iCloud workbook payload is missing. Your saved local workbook is unchanged.", details: nil, retryable: false, operation: "upload", workbookId: workbookID)
    legacy.diskState.recordRecovery = nil
    try legacy.prepareRecordRecovery()
    legacy.completeRecordRecoveryFetch()
    precondition(legacy.diskState.storedIssue != nil, "Remote fetch masked a missing local pending payload")
    try await verifyCollisions(root)
  }
}
