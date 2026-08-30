import CloudKit
import CryptoKit
import Foundation

private let cavalryContainerIdentifier = "iCloud.com.juanmbuilder.cavalry"
// Local migration marker for CKSyncEngine's opaque state. The engine owns the
// actual database-subscription identifier; Apple recommends leaving
// Configuration.subscriptionID unset unless migrating an existing custom
// CloudKit subscription.
private let cavalrySyncStateVersion = "automatic-subscription-v2"
private let cavalryZoneName = "CavalryWorkbooksV1"
private let cavalryRecordType = "CavalryWorkbook"
private let maximumPayloadBytes = 25 * 1024 * 1024
private let maximumConflictReportBytes = 128 * 1024

private struct CloudConflictNotice: Codable, Sendable, Equatable {
  let id: String
  let sourceDevice: String
  let detectedAt: String
  let baseRevision: Int?
  let remoteRevision: Int
  let summary: String
  let report: String
  var resolutionAvailable: Bool? = nil
}

private struct CloudWorkbookMetadata: Codable, Sendable {
  let id: String
  let name: String
  let year: Int?
  let currency: String
  let revision: Int
  let updatedAt: String
  var conflict: Bool? = nil
  var pending: Bool? = nil
  var conflictNotice: CloudConflictNotice? = nil
}

private struct RemoteWorkbook: Codable, Sendable {
  let metadata: CloudWorkbookMetadata
  let payloadFile: String
  let payloadHash: String
  let systemFields: Data
  let conflictPackage: StoredConflictPackage?
}

private struct StoredConflictPackage: Codable, Sendable, Equatable {
  let noticeId: String
  let sourcePayloadFile: String
  let sourcePayloadHash: String
  let basePayloadFile: String?
  let basePayloadHash: String?
}

private struct PendingWorkbook: Codable, Sendable {
  let metadata: CloudWorkbookMetadata
  let payloadFile: String
  let payloadHash: String
  let expectedRevision: Int?
}

private struct PendingConflictNoticeUpdate: Codable, Sendable {
  let notice: CloudConflictNotice?
  let clear: Bool
  var retryCount: Int
  let conflictPackage: StoredConflictPackage?
}

private struct WorkbookConflict: Codable, Sendable {
  let remoteRevision: Int?
  let remoteDeleted: Bool
  let detectedAt: String
}

private struct CloudKitDiskState: Codable {
  var syncState: CKSyncEngine.State.Serialization?
  var subscriptionIdentifier: String?
  var accountRecordName: String?
  var zoneReady = false
  var remote: [String: RemoteWorkbook] = [:]
  var pending: [String: PendingWorkbook] = [:]
  var pendingDeletes: Set<String> = []
  var conflicts: [String: WorkbookConflict] = [:]
  var pendingConflictNotices: [String: PendingConflictNoticeUpdate]?
  var rejectedSaves: [String: String]?
  var lastError: String?
  var lastSyncAt: String?
}

private struct CloudKitBridgeRequest: Codable {
  let operation: String
  let workbookId: String?
  let name: String?
  let year: Int?
  let currency: String?
  let updatedAt: String?
  let portableHtml: String?
  let expectedRevision: Int?
  let conflictResolution: String?
  let conflictNotice: CloudConflictNotice?
  let conflictPortableHtml: String?
  let conflictBasePortableHtml: String?
  let conflictNoticeId: String?
  let refresh: Bool?
}

private struct CloudKitAccount: Codable, Sendable {
  let status: String
  let userId: String?
}

private struct CloudKitDownload: Codable, Sendable {
  let metadata: CloudWorkbookMetadata
  let portableHtml: String
}

private struct CloudKitConflictPackageDownload: Codable, Sendable {
  let noticeId: String
  let sourcePortableHtml: String
  let basePortableHtml: String?
}

private struct CloudKitBridgeResponse: Codable, Sendable {
  let ok: Bool
  var code: String?
  var error: String?
  var conflict: Bool?
  var account: CloudKitAccount?
  var workbooks: [CloudWorkbookMetadata]?
  var workbook: CloudKitDownload?
  var conflictPackage: CloudKitConflictPackageDownload?
  var metadata: CloudWorkbookMetadata?
  var id: String?
  var pending: Bool?
  var pendingCount: Int?
  var lastSyncAt: String?

  static func success() -> Self {
    Self(ok: true)
  }

  static func failure(
    _ code: String,
    _ error: String,
    conflict: Bool = false
  ) -> Self {
    Self(
      ok: false,
      code: code,
      error: error,
      conflict: conflict ? true : nil
    )
  }
}

extension CKRecord.FieldKey {
  fileprivate static let schemaVersion = "schemaVersion"
  fileprivate static let workbookId = "workbookId"
  fileprivate static let name = "name"
  fileprivate static let year = "year"
  fileprivate static let currency = "currency"
  fileprivate static let revision = "revision"
  fileprivate static let sourceUpdatedAt = "sourceUpdatedAt"
  fileprivate static let payloadHash = "payloadHash"
  fileprivate static let payloadAsset = "payloadAsset"
  fileprivate static let conflictId = "conflictId"
  fileprivate static let conflictSourceDevice = "conflictSourceDevice"
  fileprivate static let conflictDetectedAt = "conflictDetectedAt"
  fileprivate static let conflictBaseRevision = "conflictBaseRevision"
  fileprivate static let conflictRemoteRevision = "conflictRemoteRevision"
  fileprivate static let conflictSummary = "conflictSummary"
  fileprivate static let conflictReport = "conflictReport"
  fileprivate static let conflictPackageNoticeId = "conflictPackageNoticeId"
  fileprivate static let conflictPayloadHash = "conflictPayloadHash"
  fileprivate static let conflictPayloadAsset = "conflictPayloadAsset"
  fileprivate static let conflictBasePayloadHash = "conflictBasePayloadHash"
  fileprivate static let conflictBasePayloadAsset = "conflictBasePayloadAsset"
}

@available(iOS 17.0, macOS 14.0, *)
actor CavalryCloudKitStore: CKSyncEngineDelegate {
  static let shared = CavalryCloudKitStore()

  private let container = CKContainer(identifier: cavalryContainerIdentifier)
  private let zoneID = CKRecordZone.ID(zoneName: cavalryZoneName)
  private let rootURL: URL
  private let payloadsURL: URL
  private let stateURL: URL
  private var diskState: CloudKitDiskState
  private var engine: CKSyncEngine?
  private var syncTask: Task<Void, Error>?
  private var sendTask: Task<Void, Error>?
  private var eventSink: (@Sendable ([String: String]) -> Void)?

  init() {
    let applicationSupport = FileManager.default.urls(
      for: .applicationSupportDirectory,
      in: .userDomainMask
    ).first!
    rootURL =
      applicationSupport
      .appendingPathComponent("com.juanmbuilder.cavalry.mac", isDirectory: true)
      .appendingPathComponent("CloudKit", isDirectory: true)
    payloadsURL = rootURL.appendingPathComponent("payloads", isDirectory: true)
    stateURL = rootURL.appendingPathComponent("sync-state.json", isDirectory: false)

    do {
      try FileManager.default.createDirectory(
        at: payloadsURL,
        withIntermediateDirectories: true
      )
      let data = try Data(contentsOf: stateURL)
      diskState = try JSONDecoder().decode(CloudKitDiskState.self, from: data)
    } catch {
      diskState = CloudKitDiskState()
    }

    if diskState.subscriptionIdentifier != cavalrySyncStateVersion {
      // Subscription identity is part of CKSyncEngine's opaque state. Reset
      // only that state for this one-time migration; Cavalry's local pending
      // workbooks and downloaded cache remain intact and are re-seeded below.
      diskState.syncState = nil
      diskState.subscriptionIdentifier = cavalrySyncStateVersion
      diskState.zoneReady = false
      if let data = try? JSONEncoder().encode(diskState) {
        try? data.write(to: stateURL, options: [.atomic])
      }
    }

    Task { await self.startIfNeeded() }
  }

  func setEventSink(_ sink: (@Sendable ([String: String]) -> Void)?) {
    eventSink = sink
  }

  func request(_ rawRequest: String) async -> String {
    let response: CloudKitBridgeResponse
    do {
      let request = try JSONDecoder().decode(
        CloudKitBridgeRequest.self,
        from: Data(rawRequest.utf8)
      )
      response = await perform(request)
    } catch {
      response = .failure(
        "invalid_cloudkit_request",
        "Cavalry received an invalid CloudKit request."
      )
    }
    do {
      return String(
        data: try JSONEncoder().encode(response),
        encoding: .utf8
      ) ?? "{\"ok\":false,\"code\":\"cloudkit_encoding_failed\"}"
    } catch {
      return
        "{\"ok\":false,\"code\":\"cloudkit_encoding_failed\",\"error\":\"CloudKit could not encode its response.\"}"
    }
  }

  private func perform(_ request: CloudKitBridgeRequest) async -> CloudKitBridgeResponse {
    startIfNeeded()
    switch request.operation {
    case "status":
      return await statusResponse()
    case "sync":
      do {
        try await syncNow()
        return await statusResponse()
      } catch {
        return cloudFailure(error, fallbackCode: "cloud_sync_failed")
      }
    case "list":
      if request.refresh == true {
        do {
          try await syncNow()
        } catch {
          if diskState.remote.isEmpty {
            return cloudFailure(error, fallbackCode: "cloud_list_failed")
          }
        }
      }
      var visible = Dictionary(
        uniqueKeysWithValues: diskState.remote.map { ($0.key, $0.value.metadata) }
      )
      for (recordName, pending) in diskState.pending {
        var metadata = pending.metadata
        metadata.pending = true
        metadata.conflictNotice = diskState.remote[recordName]?.metadata.conflictNotice
        visible[recordName] = metadata
      }
      for recordName in diskState.conflicts.keys {
        guard let metadata = visible[recordName] else { continue }
        visible[recordName] = CloudWorkbookMetadata(
          id: metadata.id,
          name: metadata.name,
          year: metadata.year,
          currency: metadata.currency,
          revision: metadata.revision,
          updatedAt: metadata.updatedAt,
          conflict: true,
          pending: metadata.pending,
          conflictNotice: metadata.conflictNotice
        )
      }
      for (recordName, update) in diskState.pendingConflictNotices ?? [:] {
        guard var metadata = visible[recordName] else { continue }
        metadata.conflictNotice = update.clear ? nil : update.notice
        visible[recordName] = metadata
      }
      for recordName in diskState.pendingDeletes {
        visible.removeValue(forKey: recordName)
      }
      return CloudKitBridgeResponse(
        ok: true,
        workbooks: visible.values
          .sorted { $0.updatedAt > $1.updatedAt },
        pendingCount: diskState.pending.count + diskState.pendingDeletes.count
          + (diskState.pendingConflictNotices?.count ?? 0),
        lastSyncAt: diskState.lastSyncAt
      )
    case "download":
      return download(workbookId: request.workbookId)
    case "download_conflict":
      return downloadConflictPackage(
        workbookId: request.workbookId,
        noticeId: request.conflictNoticeId
      )
    case "save":
      return await save(request)
    case "publish_conflict":
      return await updateConflictNotice(request, clearing: false)
    case "clear_conflict":
      return await updateConflictNotice(request, clearing: true)
    case "delete":
      return await delete(workbookId: request.workbookId)
    default:
      return .failure(
        "unsupported_cloudkit_operation",
        "Cavalry does not support that CloudKit operation."
      )
    }
  }

  private func startIfNeeded() {
    guard engine == nil else { return }
    var configuration = CKSyncEngine.Configuration(
      database: container.privateCloudDatabase,
      stateSerialization: diskState.syncState,
      delegate: self
    )
    configuration.automaticallySync = true
    let nextEngine = CKSyncEngine(configuration)
    engine = nextEngine
    if !diskState.zoneReady {
      nextEngine.state.add(
        pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))]
      )
    }
    for recordName in diskState.pending.keys {
      nextEngine.state.add(
        pendingRecordZoneChanges: [.saveRecord(recordID(recordName))]
      )
    }
    for recordName in (diskState.pendingConflictNotices ?? [:]).keys {
      nextEngine.state.add(
        pendingRecordZoneChanges: [.saveRecord(recordID(recordName))]
      )
    }
    for recordName in diskState.pendingDeletes {
      nextEngine.state.add(
        pendingRecordZoneChanges: [.deleteRecord(recordID(recordName))]
      )
    }
  }

  private func statusResponse() async -> CloudKitBridgeResponse {
    let account = await accountState()
    var response = CloudKitBridgeResponse.success()
    response.account = account
    response.pendingCount = diskState.pending.count + diskState.pendingDeletes.count
      + (diskState.pendingConflictNotices?.count ?? 0)
    response.lastSyncAt = diskState.lastSyncAt
    response.error = diskState.lastError
    return response
  }

  private func accountState() async -> CloudKitAccount {
    do {
      let status = try await container.accountStatus()
      switch status {
      case .available:
        do {
          let userId = try await container.userRecordID().recordName
          if let previous = diskState.accountRecordName, previous != userId {
            resetForAccountChange(accountRecordName: userId)
          } else if diskState.accountRecordName == nil {
            diskState.accountRecordName = userId
            try? persist()
          }
          return CloudKitAccount(status: "available", userId: userId)
        } catch {
          return CloudKitAccount(status: "available", userId: "icloud-private")
        }
      case .noAccount:
        return CloudKitAccount(status: "no_account", userId: nil)
      case .restricted:
        return CloudKitAccount(status: "restricted", userId: nil)
      case .couldNotDetermine:
        return CloudKitAccount(status: "could_not_determine", userId: nil)
      case .temporarilyUnavailable:
        return CloudKitAccount(status: "temporarily_unavailable", userId: nil)
      @unknown default:
        return CloudKitAccount(status: "could_not_determine", userId: nil)
      }
    } catch {
      return CloudKitAccount(status: "could_not_determine", userId: nil)
    }
  }

  private func syncNow() async throws {
    if let syncTask {
      return try await syncTask.value
    }
    guard let engine else { throw CloudStoreError.engineUnavailable }
    let task = Task {
      try await engine.fetchChanges()
      try await engine.sendChanges()
    }
    syncTask = task
    defer { syncTask = nil }
    try await task.value
    diskState.lastSyncAt = isoDate(Date())
    diskState.lastError = nil
    try persist()
  }

  private func sendNow() async throws {
    if let sendTask {
      return try await sendTask.value
    }
    guard let engine else { throw CloudStoreError.engineUnavailable }
    let task = Task { try await engine.sendChanges() }
    sendTask = task
    defer { sendTask = nil }
    try await task.value
  }

  private func save(_ request: CloudKitBridgeRequest) async -> CloudKitBridgeResponse {
    guard
      let workbookId = normalizedWorkbookId(request.workbookId),
      let portableHtml = request.portableHtml,
      let name = normalizedName(request.name),
      let currency = normalizedCurrency(request.currency),
      let updatedAt = normalizedDate(request.updatedAt)
    else {
      return .failure(
        "cloud_snapshot_invalid",
        "The workbook is not valid for CloudKit sync."
      )
    }
    let payload = Data(portableHtml.utf8)
    guard !payload.isEmpty, payload.count <= maximumPayloadBytes else {
      return .failure(
        "cloud_quota_exceeded",
        "The workbook is too large to sync with iCloud."
      )
    }
    if let expected = request.expectedRevision, expected < 1 {
      return .failure("invalid_revision", "The expected iCloud revision is invalid.")
    }

    let recordName = hashedRecordName(workbookId)
    let remote = diskState.remote[recordName]
    let previousPending = diskState.pending[recordName]
    let expectedRevision = request.expectedRevision
    let explicitlyKeepingLocal = request.conflictResolution == "keep_local"
    if let conflict = diskState.conflicts[recordName] {
      let matchesReviewedState =
        conflict.remoteDeleted
        ? remote == nil && expectedRevision == nil
        : expectedRevision != nil && expectedRevision == remote?.metadata.revision
      guard explicitlyKeepingLocal && matchesReviewedState else {
        return revisionConflict()
      }
      diskState.conflicts.removeValue(forKey: recordName)
    }
    if remote?.metadata.id != workbookId {
      if remote != nil { return revisionConflict() }
    }
    if let previousPending {
      guard expectedRevision == previousPending.metadata.revision else {
        return revisionConflict()
      }
    } else {
      if let remote {
        guard expectedRevision == remote.metadata.revision else {
          return revisionConflict()
        }
      } else if expectedRevision != nil {
        return revisionConflict()
      }
    }

    let revision = (expectedRevision ?? 0) + 1
    let metadata = CloudWorkbookMetadata(
      id: workbookId,
      name: name,
      year: request.year,
      currency: currency,
      revision: revision,
      updatedAt: updatedAt
    )
    let payloadHash = sha256(payload)
    let fileName = "pending-\(recordName)-\(revision).html"
    do {
      try payload.write(to: payloadURL(fileName), options: [.atomic])
      removePendingPayload(recordName: recordName)
      diskState.pending[recordName] = PendingWorkbook(
        metadata: metadata,
        payloadFile: fileName,
        payloadHash: payloadHash,
        expectedRevision: previousPending?.expectedRevision ?? expectedRevision
      )
      diskState.pendingDeletes.remove(recordName)
      diskState.rejectedSaves?.removeValue(forKey: recordName)
      diskState.lastError = nil
      try persist()
      guard let engine else { throw CloudStoreError.engineUnavailable }
      if !diskState.zoneReady {
        engine.state.add(
          pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))]
        )
      }
      engine.state.add(
        pendingRecordZoneChanges: [.saveRecord(recordID(recordName))]
      )
      emit(reason: "state_changed", workbookId: workbookId)
      do {
        try await sendNow()
      } catch {
        diskState.lastError = publicMessage(error)
        try? persist()
      }
    } catch {
      diskState.lastError = publicMessage(error)
      try? persist()
      return cloudFailure(error, fallbackCode: "cloud_upload_failed")
    }

    if let rejection = diskState.rejectedSaves?[recordName] {
      diskState.rejectedSaves?.removeValue(forKey: recordName)
      try? persist()
      return .failure("cloud_change_rejected", rejection)
    }
    if diskState.conflicts[recordName] != nil { return revisionConflict() }
    if diskState.pending[recordName] != nil {
      return CloudKitBridgeResponse(ok: true, metadata: metadata, pending: true)
    }
    if diskState.remote[recordName]?.metadata.revision == revision {
      return CloudKitBridgeResponse(ok: true, metadata: metadata, pending: false)
    }
    return .failure(
      "cloud_upload_failed",
      diskState.lastError ?? "The workbook could not be queued for iCloud sync."
    )
  }

  private func updateConflictNotice(
    _ request: CloudKitBridgeRequest,
    clearing: Bool
  ) async -> CloudKitBridgeResponse {
    guard let workbookId = normalizedWorkbookId(request.workbookId) else {
      return .failure("invalid_workbook_id", "Choose a valid iCloud workbook.")
    }
    let recordName = hashedRecordName(workbookId)
    guard let remote = diskState.remote[recordName], remote.metadata.id == workbookId else {
      return .failure(
        "cloud_conflict_notice_failed",
        "The iCloud workbook is not available for conflict review."
      )
    }
    let notice: CloudConflictNotice?
    var conflictPackage: StoredConflictPackage?
    if clearing {
      notice = nil
    } else {
      guard
        let requested = request.conflictNotice,
        let validated = normalizedConflictNotice(requested, workbookId: workbookId)
      else {
        return .failure(
          "cloud_conflict_notice_invalid",
          "The conflict details could not be shared safely."
        )
      }
      do {
        if let portableHtml = request.conflictPortableHtml {
          conflictPackage = try storePendingConflictPackage(
            recordName: recordName,
            noticeId: validated.id,
            sourcePortableHtml: portableHtml,
            basePortableHtml: request.conflictBasePortableHtml
          )
        }
      } catch {
        return .failure(
          "cloud_conflict_package_invalid",
          "The workbook copies needed for conflict review were invalid."
        )
      }
      notice = noticeWithResolutionAvailability(
        validated,
        resolutionAvailable: conflictPackage != nil
      )
    }

    var updates = diskState.pendingConflictNotices ?? [:]
    removePendingConflictPackage(recordName: recordName)
    updates[recordName] = PendingConflictNoticeUpdate(
      notice: notice,
      clear: clearing,
      retryCount: 0,
      conflictPackage: conflictPackage
    )
    diskState.pendingConflictNotices = updates
    if clearing { diskState.conflicts.removeValue(forKey: recordName) }
    diskState.lastError = nil
    do {
      try persist()
      guard let engine else { throw CloudStoreError.engineUnavailable }
      engine.state.add(
        pendingRecordZoneChanges: [.saveRecord(recordID(recordName))]
      )
      emit(reason: "state_changed", workbookId: workbookId)
      do {
        try await sendNow()
      } catch {
        diskState.lastError = publicMessage(error)
        try? persist()
      }
    } catch {
      return cloudFailure(error, fallbackCode: "cloud_conflict_notice_failed")
    }

    var metadata = diskState.remote[recordName]?.metadata ?? remote.metadata
    let pending = diskState.pendingConflictNotices?[recordName] != nil
    if pending { metadata.conflictNotice = notice }
    return CloudKitBridgeResponse(ok: true, metadata: metadata, pending: pending)
  }

  private func download(workbookId rawWorkbookId: String?) -> CloudKitBridgeResponse {
    guard let workbookId = normalizedWorkbookId(rawWorkbookId) else {
      return .failure("invalid_workbook_id", "Choose a valid iCloud workbook.")
    }
    let recordName = hashedRecordName(workbookId)
    if let pending = diskState.pending[recordName], pending.metadata.id == workbookId {
      do {
        let data = try Data(contentsOf: payloadURL(pending.payloadFile))
        guard data.count <= maximumPayloadBytes, sha256(data) == pending.payloadHash else {
          throw CloudStoreError.invalidPayload
        }
        guard let portableHtml = String(data: data, encoding: .utf8) else {
          throw CloudStoreError.invalidPayload
        }
        return CloudKitBridgeResponse(
          ok: true,
          workbook: CloudKitDownload(metadata: pending.metadata, portableHtml: portableHtml),
          pending: true
        )
      } catch {
        return .failure(
          "cloud_download_failed",
          "The pending iCloud workbook could not be read safely."
        )
      }
    }
    guard let remote = diskState.remote[recordName], remote.metadata.id == workbookId else {
      return .failure(
        "cloud_download_failed",
        "That workbook is not available in this iCloud account."
      )
    }
    do {
      let data = try Data(contentsOf: payloadURL(remote.payloadFile))
      guard data.count <= maximumPayloadBytes, sha256(data) == remote.payloadHash else {
        throw CloudStoreError.invalidPayload
      }
      guard let portableHtml = String(data: data, encoding: .utf8) else {
        throw CloudStoreError.invalidPayload
      }
      diskState.conflicts.removeValue(forKey: recordName)
      try persist()
      return CloudKitBridgeResponse(
        ok: true,
        workbook: CloudKitDownload(metadata: remote.metadata, portableHtml: portableHtml)
      )
    } catch {
      return .failure(
        "cloud_download_failed",
        "The iCloud workbook could not be read safely."
      )
    }
  }

  private func downloadConflictPackage(
    workbookId rawWorkbookId: String?,
    noticeId rawNoticeId: String?
  ) -> CloudKitBridgeResponse {
    guard
      let workbookId = normalizedWorkbookId(rawWorkbookId),
      let noticeId = normalizedConflictText(rawNoticeId, maximum: 128),
      noticeId.range(of: "^[A-Za-z0-9._:-]+$", options: .regularExpression) != nil
    else {
      return .failure(
        "invalid_conflict_notice",
        "Open the latest conflict review and try again."
      )
    }
    let recordName = hashedRecordName(workbookId)
    let pendingUpdate = diskState.pendingConflictNotices?[recordName]
    let package: StoredConflictPackage?
    if
      pendingUpdate?.clear == false,
      pendingUpdate?.notice?.id == noticeId,
      pendingUpdate?.conflictPackage?.noticeId == noticeId
    {
      package = pendingUpdate?.conflictPackage
    } else if
      diskState.remote[recordName]?.metadata.id == workbookId,
      diskState.remote[recordName]?.metadata.conflictNotice?.id == noticeId,
      diskState.remote[recordName]?.conflictPackage?.noticeId == noticeId
    {
      package = diskState.remote[recordName]?.conflictPackage
    } else {
      package = nil
    }
    guard let package else {
      return .failure(
        "cloud_conflict_package_unavailable",
        "The conflict details are still syncing. Try Sync Now again in a moment."
      )
    }
    do {
      let source = try readConflictPayload(
        fileName: package.sourcePayloadFile,
        expectedHash: package.sourcePayloadHash
      )
      let base: String?
      if let fileName = package.basePayloadFile, let expectedHash = package.basePayloadHash {
        base = try readConflictPayload(fileName: fileName, expectedHash: expectedHash)
      } else if package.basePayloadFile == nil && package.basePayloadHash == nil {
        base = nil
      } else {
        throw CloudStoreError.invalidPayload
      }
      return CloudKitBridgeResponse(
        ok: true,
        conflictPackage: CloudKitConflictPackageDownload(
          noticeId: noticeId,
          sourcePortableHtml: source,
          basePortableHtml: base
        )
      )
    } catch {
      return .failure(
        "cloud_conflict_package_invalid",
        "The conflict details failed their integrity check. Sync again before resolving."
      )
    }
  }

  private func delete(workbookId rawWorkbookId: String?) async -> CloudKitBridgeResponse {
    guard let workbookId = normalizedWorkbookId(rawWorkbookId) else {
      return .failure("invalid_workbook_id", "Choose a valid iCloud workbook.")
    }
    let recordName = hashedRecordName(workbookId)
    if diskState.remote[recordName] == nil,
      diskState.pending[recordName]?.metadata.id == workbookId
    {
      removePendingPayload(recordName: recordName)
      diskState.pending.removeValue(forKey: recordName)
      removePendingConflictPackage(recordName: recordName)
      diskState.pendingConflictNotices?.removeValue(forKey: recordName)
      diskState.conflicts.removeValue(forKey: recordName)
      engine?.state.remove(
        pendingRecordZoneChanges: [.saveRecord(recordID(recordName))]
      )
      try? persist()
      emit(reason: "deleted", workbookId: workbookId)
      return CloudKitBridgeResponse(ok: true, id: workbookId, pending: false)
    }
    guard diskState.remote[recordName]?.metadata.id == workbookId else {
      return .failure(
        "cloud_delete_failed",
        "That workbook is not available in this iCloud account."
      )
    }
    removePendingPayload(recordName: recordName)
    diskState.pending.removeValue(forKey: recordName)
    removePendingConflictPackage(recordName: recordName)
    diskState.pendingConflictNotices?.removeValue(forKey: recordName)
    diskState.pendingDeletes.insert(recordName)
    diskState.conflicts.removeValue(forKey: recordName)
    do {
      try persist()
      guard let engine else { throw CloudStoreError.engineUnavailable }
      engine.state.add(
        pendingRecordZoneChanges: [.deleteRecord(recordID(recordName))]
      )
      do {
        try await sendNow()
      } catch {
        diskState.lastError = publicMessage(error)
        try? persist()
      }
      if diskState.pendingDeletes.contains(recordName) {
        return CloudKitBridgeResponse(ok: true, id: workbookId, pending: true)
      }
      guard diskState.remote[recordName] == nil else {
        return .failure(
          "cloud_delete_failed",
          diskState.lastError ?? "The iCloud workbook could not be removed."
        )
      }
      return CloudKitBridgeResponse(ok: true, id: workbookId, pending: false)
    } catch {
      diskState.lastError = publicMessage(error)
      try? persist()
      return cloudFailure(error, fallbackCode: "cloud_delete_failed")
    }
  }

  func handleEvent(_ event: CKSyncEngine.Event, syncEngine: CKSyncEngine) async {
    switch event {
    case .stateUpdate(let event):
      diskState.syncState = event.stateSerialization
      try? persist()
    case .accountChange(let event):
      let current: String?
      switch event.changeType {
      case .signIn(let currentUser):
        current = currentUser.recordName
      case .signOut:
        current = nil
      case .switchAccounts(_, let currentUser):
        current = currentUser.recordName
      @unknown default:
        return
      }
      let previous = diskState.accountRecordName
      let accountChanged = previous != current
      if accountChanged {
        // Pending work created before the first iCloud sign-in belongs to no
        // other account, so it is safe to carry into that first account. A
        // sign-out or switch must clear account-scoped queued work instead.
        resetForAccountChange(
          accountRecordName: current,
          preservePending: previous == nil && current != nil
        )
      } else if diskState.subscriptionIdentifier != cavalrySyncStateVersion {
        diskState.subscriptionIdentifier = cavalrySyncStateVersion
        try? persist()
      }
      // CKSyncEngine already resets its internal state for an account change.
      // Recreating it here would deliver the same sign-in event to the new
      // engine and loop forever. Re-seed the zone and any work that is still
      // valid for this private database. CKSyncEngine de-duplicates changes
      // that were already pending.
      if current != nil {
        if accountChanged || !diskState.zoneReady {
          syncEngine.state.add(
            pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))]
          )
        }
        for recordName in diskState.pending.keys {
          syncEngine.state.add(
            pendingRecordZoneChanges: [.saveRecord(recordID(recordName))]
          )
        }
        for recordName in (diskState.pendingConflictNotices ?? [:]).keys {
          syncEngine.state.add(
            pendingRecordZoneChanges: [.saveRecord(recordID(recordName))]
          )
        }
        for recordName in diskState.pendingDeletes {
          syncEngine.state.add(
            pendingRecordZoneChanges: [.deleteRecord(recordID(recordName))]
          )
        }
      }
      emit(reason: "account_changed")
    case .fetchedDatabaseChanges(let event):
      if event.deletions.contains(where: { $0.zoneID == zoneID }) {
        clearRemoteCache()
      }
      try? persist()
    case .fetchedRecordZoneChanges(let event):
      var changed = false
      for modification in event.modifications
      where modification.record.recordType == cavalryRecordType {
        changed = applyFetchedRecord(modification.record) || changed
      }
      for deletion in event.deletions where deletion.recordID.zoneID == zoneID {
        changed = applyFetchedDeletion(deletion.recordID) || changed
      }
      if changed {
        diskState.lastSyncAt = isoDate(Date())
        diskState.lastError = nil
        try? persist()
        emit(reason: "fetched")
      }
    case .sentDatabaseChanges(let event):
      if event.savedZones.contains(where: { $0.zoneID == zoneID }) {
        diskState.zoneReady = true
        diskState.lastError = nil
      }
      if let failed = event.failedZoneSaves.first(where: { $0.zone.zoneID == zoneID }) {
        diskState.zoneReady = false
        diskState.lastError = publicMessage(failed.error)
      }
      try? persist()
    case .sentRecordZoneChanges(let event):
      var changed = false
      for record in event.savedRecords where record.recordType == cavalryRecordType {
        changed = applySavedRecord(record) || changed
      }
      for recordID in event.deletedRecordIDs where recordID.zoneID == zoneID {
        changed = applySavedDeletion(recordID) || changed
      }
      for failure in event.failedRecordSaves where failure.record.recordType == cavalryRecordType {
        changed = handleFailedSave(failure, syncEngine: syncEngine) || changed
      }
      for (recordID, error) in event.failedRecordDeletes where recordID.zoneID == zoneID {
        changed = handleFailedDelete(recordID, error: error) || changed
      }
      if changed {
        diskState.lastSyncAt = isoDate(Date())
        try? persist()
        emit(reason: "sent")
      }
    case .didFetchRecordZoneChanges(let event):
      if let error = event.error {
        diskState.lastError = publicMessage(error)
        try? persist()
      }
    case .didFetchChanges:
      diskState.lastSyncAt = isoDate(Date())
      try? persist()
    case .didSendChanges:
      diskState.lastSyncAt = isoDate(Date())
      try? persist()
    case .willFetchChanges, .willFetchRecordZoneChanges,
      .willSendChanges:
      break
    @unknown default:
      break
    }
  }

  func nextRecordZoneChangeBatch(
    _ context: CKSyncEngine.SendChangesContext,
    syncEngine: CKSyncEngine
  ) async -> CKSyncEngine.RecordZoneChangeBatch? {
    let changes = syncEngine.state.pendingRecordZoneChanges.filter {
      context.options.scope.contains($0)
    }
    return await CKSyncEngine.RecordZoneChangeBatch(pendingChanges: changes) {
      [weak self] recordID in
      guard let self else { return nil }
      return await self.recordToSave(recordID)
    }
  }

  private func recordToSave(_ recordID: CKRecord.ID) -> CKRecord? {
    let recordName = recordID.recordName
    let pendingWorkbook = diskState.pending[recordName]
    let pendingNotice = diskState.pendingConflictNotices?[recordName]
    guard pendingWorkbook != nil || pendingNotice != nil else {
      engine?.state.remove(
        pendingRecordZoneChanges: [.saveRecord(recordID)]
      )
      return nil
    }
    let record: CKRecord
    if let remote = diskState.remote[recordName],
      let decoded = decodeSystemFields(remote.systemFields)
    {
      record = decoded
    } else {
      guard pendingWorkbook != nil else { return nil }
      record = CKRecord(recordType: cavalryRecordType, recordID: recordID)
    }
    if let pendingWorkbook {
      guard FileManager.default.fileExists(atPath: payloadURL(pendingWorkbook.payloadFile).path) else {
        diskState.lastError = "A pending iCloud workbook payload is missing."
        return nil
      }
      populate(record, from: pendingWorkbook)
    } else if let remote = diskState.remote[recordName] {
      guard FileManager.default.fileExists(atPath: payloadURL(remote.payloadFile).path) else {
        diskState.lastError = "The cached iCloud workbook payload is missing."
        return nil
      }
      populate(record, from: remote)
    }
    if let pendingNotice {
      if let package = pendingNotice.conflictPackage, !conflictPackageFilesExist(package) {
        diskState.lastError = "The conflict review payload is missing."
        return nil
      }
      populateConflictNotice(
        record,
        notice: pendingNotice.clear ? nil : pendingNotice.notice
      )
      populateConflictPackage(
        record,
        package: pendingNotice.clear ? nil : pendingNotice.conflictPackage
      )
    } else if let remote = diskState.remote[recordName] {
      if let package = remote.conflictPackage, !conflictPackageFilesExist(package) {
        diskState.lastError = "The cached conflict review payload is missing."
        return nil
      }
      populateConflictNotice(record, notice: remote.metadata.conflictNotice)
      populateConflictPackage(record, package: remote.conflictPackage)
    }
    return record
  }

  private func populate(_ record: CKRecord, from pending: PendingWorkbook) {
    let metadata = pending.metadata
    record[.schemaVersion] = 1 as CKRecordValue
    record.encryptedValues[.workbookId] = metadata.id as CKRecordValue
    record.encryptedValues[.name] = metadata.name as CKRecordValue
    record.encryptedValues[.year] = metadata.year.map(NSNumber.init(value:))
    record.encryptedValues[.currency] = metadata.currency as CKRecordValue
    record.encryptedValues[.revision] = NSNumber(value: metadata.revision)
    record.encryptedValues[.sourceUpdatedAt] = metadata.updatedAt as CKRecordValue
    record.encryptedValues[.payloadHash] = pending.payloadHash as CKRecordValue
    record[.payloadAsset] = CKAsset(
      fileURL: payloadURL(pending.payloadFile)
    )
  }

  private func populate(_ record: CKRecord, from remote: RemoteWorkbook) {
    let metadata = remote.metadata
    record[.schemaVersion] = 1 as CKRecordValue
    record.encryptedValues[.workbookId] = metadata.id as CKRecordValue
    record.encryptedValues[.name] = metadata.name as CKRecordValue
    record.encryptedValues[.year] = metadata.year.map(NSNumber.init(value:))
    record.encryptedValues[.currency] = metadata.currency as CKRecordValue
    record.encryptedValues[.revision] = NSNumber(value: metadata.revision)
    record.encryptedValues[.sourceUpdatedAt] = metadata.updatedAt as CKRecordValue
    record.encryptedValues[.payloadHash] = remote.payloadHash as CKRecordValue
    record[.payloadAsset] = CKAsset(fileURL: payloadURL(remote.payloadFile))
  }

  private func populateConflictNotice(
    _ record: CKRecord,
    notice: CloudConflictNotice?
  ) {
    record.encryptedValues[.conflictId] = notice?.id as CKRecordValue?
    record.encryptedValues[.conflictSourceDevice] = notice?.sourceDevice as CKRecordValue?
    record.encryptedValues[.conflictDetectedAt] = notice?.detectedAt as CKRecordValue?
    record.encryptedValues[.conflictBaseRevision] = notice?.baseRevision.map(NSNumber.init(value:))
    record.encryptedValues[.conflictRemoteRevision] = notice.map {
      NSNumber(value: $0.remoteRevision)
    }
    record.encryptedValues[.conflictSummary] = notice?.summary as CKRecordValue?
    record.encryptedValues[.conflictReport] = notice?.report as CKRecordValue?
  }

  private func populateConflictPackage(
    _ record: CKRecord,
    package: StoredConflictPackage?
  ) {
    record.encryptedValues[.conflictPackageNoticeId] = package?.noticeId as CKRecordValue?
    record.encryptedValues[.conflictPayloadHash] = package?.sourcePayloadHash as CKRecordValue?
    record[.conflictPayloadAsset] = package.map {
      CKAsset(fileURL: payloadURL($0.sourcePayloadFile))
    }
    record.encryptedValues[.conflictBasePayloadHash] = package?.basePayloadHash as CKRecordValue?
    let baseAsset: CKAsset? = package?.basePayloadFile.map {
      CKAsset(fileURL: payloadURL($0))
    }
    record[.conflictBasePayloadAsset] = baseAsset
  }

  private func applyFetchedRecord(_ record: CKRecord) -> Bool {
    guard let decoded = decodeRemoteRecord(record) else { return false }
    let recordName = record.recordID.recordName
    acknowledgeConflictNoticeIfMatched(recordName: recordName, metadata: decoded.metadata)
    if let pending = diskState.pending[recordName] {
      if pending.metadata.revision == decoded.metadata.revision,
        pending.payloadHash == decoded.payloadHash
      {
        replaceRemote(recordName: recordName, with: decoded)
        removePendingPayload(recordName: recordName)
        diskState.pending.removeValue(forKey: recordName)
        diskState.conflicts.removeValue(forKey: recordName)
        engine?.state.remove(
          pendingRecordZoneChanges: [.saveRecord(recordID(recordName))]
        )
        if diskState.pendingConflictNotices?[recordName] != nil {
          engine?.state.add(
            pendingRecordZoneChanges: [.saveRecord(recordID(recordName))]
          )
        }
        return true
      }
      let remoteRevision = decoded.metadata.revision
      if pending.expectedRevision != remoteRevision {
        latchConflict(
          recordName: recordName,
          workbookId: pending.metadata.id,
          remoteRevision: remoteRevision,
          remoteDeleted: false
        )
      }
    }
    replaceRemote(recordName: recordName, with: decoded)
    return true
  }

  private func applyFetchedDeletion(_ recordID: CKRecord.ID) -> Bool {
    let recordName = recordID.recordName
    if let pending = diskState.pending[recordName] {
      latchConflict(
        recordName: recordName,
        workbookId: pending.metadata.id,
        remoteRevision: nil,
        remoteDeleted: true
      )
    }
    removeRemotePayload(recordName: recordName)
    diskState.remote.removeValue(forKey: recordName)
    removePendingConflictPackage(recordName: recordName)
    diskState.pendingConflictNotices?.removeValue(forKey: recordName)
    return true
  }

  private func applySavedRecord(_ record: CKRecord) -> Bool {
    let recordName = record.recordID.recordName
    guard let decoded = decodeRemoteRecord(record) else { return false }
    let pending = diskState.pending[recordName]
    if let pending, decoded.metadata.revision != pending.metadata.revision { return false }
    guard pending != nil || diskState.pendingConflictNotices?[recordName] != nil else {
      return false
    }
    replaceRemote(recordName: recordName, with: decoded)
    if pending != nil {
      removePendingPayload(recordName: recordName)
      diskState.pending.removeValue(forKey: recordName)
      diskState.conflicts.removeValue(forKey: recordName)
    }
    acknowledgeConflictNoticeIfMatched(recordName: recordName, metadata: decoded.metadata)
    if diskState.pendingConflictNotices?[recordName] != nil {
      engine?.state.add(
        pendingRecordZoneChanges: [.saveRecord(recordID(recordName))]
      )
    }
    diskState.lastError = nil
    return true
  }

  private func acknowledgeConflictNoticeIfMatched(
    recordName: String,
    metadata: CloudWorkbookMetadata
  ) {
    guard let update = diskState.pendingConflictNotices?[recordName] else { return }
    let expected = update.clear ? nil : update.notice
    guard metadata.conflictNotice == expected else { return }
    removePendingConflictPackage(recordName: recordName)
    diskState.pendingConflictNotices?.removeValue(forKey: recordName)
    if diskState.pendingConflictNotices?.isEmpty == true {
      diskState.pendingConflictNotices = nil
    }
  }

  private func applySavedDeletion(_ recordID: CKRecord.ID) -> Bool {
    let recordName = recordID.recordName
    removeRemotePayload(recordName: recordName)
    removePendingPayload(recordName: recordName)
    diskState.remote.removeValue(forKey: recordName)
    diskState.pending.removeValue(forKey: recordName)
    removePendingConflictPackage(recordName: recordName)
    diskState.pendingConflictNotices?.removeValue(forKey: recordName)
    diskState.pendingDeletes.remove(recordName)
    diskState.conflicts.removeValue(forKey: recordName)
    diskState.lastError = nil
    return true
  }

  private func handleFailedSave(
    _ failure: CKSyncEngine.Event.SentRecordZoneChanges.FailedRecordSave,
    syncEngine: CKSyncEngine
  ) -> Bool {
    let recordName = failure.record.recordID.recordName
    switch failure.error.code {
    case .serverRecordChanged:
      if let serverRecord = failure.error.serverRecord {
        _ = applyFetchedRecord(serverRecord)
      }
      if let pending = diskState.pending[recordName] {
        latchConflict(
          recordName: recordName,
          workbookId: pending.metadata.id,
          remoteRevision: diskState.remote[recordName]?.metadata.revision,
          remoteDeleted: false
        )
      }
      if var update = diskState.pendingConflictNotices?[recordName], update.retryCount < 1 {
        update.retryCount += 1
        diskState.pendingConflictNotices?[recordName] = update
        syncEngine.state.add(
          pendingRecordZoneChanges: [.saveRecord(failure.record.recordID)]
        )
      } else {
        if diskState.pendingConflictNotices?[recordName] != nil {
          removePendingConflictPackage(recordName: recordName)
          diskState.pendingConflictNotices?.removeValue(forKey: recordName)
          diskState.lastError = "Conflict details could not be shared with your other devices."
        }
        syncEngine.state.remove(
          pendingRecordZoneChanges: [.saveRecord(failure.record.recordID)]
        )
      }
      return true
    case .zoneNotFound:
      diskState.zoneReady = false
      syncEngine.state.add(
        pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))]
      )
      syncEngine.state.add(
        pendingRecordZoneChanges: [.saveRecord(failure.record.recordID)]
      )
      return true
    case .unknownItem:
      if diskState.pendingConflictNotices?[recordName] != nil {
        removePendingConflictPackage(recordName: recordName)
        diskState.pendingConflictNotices?.removeValue(forKey: recordName)
        diskState.lastError = "The workbook was removed before its conflict details could be shared."
        syncEngine.state.remove(
          pendingRecordZoneChanges: [.saveRecord(failure.record.recordID)]
        )
      } else if diskState.pending[recordName]?.expectedRevision == nil {
        syncEngine.state.add(
          pendingRecordZoneChanges: [.saveRecord(failure.record.recordID)]
        )
      } else if let pending = diskState.pending[recordName] {
        latchConflict(
          recordName: recordName,
          workbookId: pending.metadata.id,
          remoteRevision: nil,
          remoteDeleted: true
        )
        syncEngine.state.remove(
          pendingRecordZoneChanges: [.saveRecord(failure.record.recordID)]
        )
      }
      return true
    case .networkFailure, .networkUnavailable, .zoneBusy, .serviceUnavailable,
      .notAuthenticated, .accountTemporarilyUnavailable, .requestRateLimited,
      .operationCancelled:
      diskState.lastError = publicMessage(failure.error)
      return true
    default:
      let message = publicMessage(failure.error)
      diskState.lastError = message
      syncEngine.state.remove(
        pendingRecordZoneChanges: [.saveRecord(failure.record.recordID)]
      )
      removePendingPayload(recordName: recordName)
      if diskState.pending[recordName] != nil {
        diskState.pending.removeValue(forKey: recordName)
        var rejectedSaves = diskState.rejectedSaves ?? [:]
        rejectedSaves[recordName] = message
        diskState.rejectedSaves = rejectedSaves
      }
      removePendingConflictPackage(recordName: recordName)
      diskState.pendingConflictNotices?.removeValue(forKey: recordName)
      return true
    }
  }

  private func handleFailedDelete(_ recordID: CKRecord.ID, error: CKError) -> Bool {
    if error.code == .unknownItem {
      return applySavedDeletion(recordID)
    }
    diskState.lastError = publicMessage(error)
    switch error.code {
    case .networkFailure, .networkUnavailable, .zoneBusy, .serviceUnavailable,
      .notAuthenticated, .accountTemporarilyUnavailable, .requestRateLimited,
      .operationCancelled:
      break
    case .zoneNotFound:
      return applySavedDeletion(recordID)
    default:
      diskState.pendingDeletes.remove(recordID.recordName)
    }
    return true
  }

  private func decodeRemoteRecord(_ record: CKRecord) -> RemoteWorkbook? {
    guard
      let metadata = metadata(from: record),
      let payloadHash = record.encryptedValues[.payloadHash] as? String,
      let asset = record[.payloadAsset] as? CKAsset,
      let assetURL = asset.fileURL
    else { return nil }
    do {
      let data = try Data(contentsOf: assetURL)
      guard
        !data.isEmpty,
        data.count <= maximumPayloadBytes,
        sha256(data) == payloadHash
      else { throw CloudStoreError.invalidPayload }
      let recordName = record.recordID.recordName
      let fileName = "remote-\(recordName)-\(metadata.revision).html"
      try data.write(to: payloadURL(fileName), options: [.atomic])
      let conflictPackage = decodeConflictPackage(
        from: record,
        recordName: recordName,
        noticeId: metadata.conflictNotice?.id
      )
      let resolvedMetadata = cloudMetadata(
        metadata,
        conflictResolutionAvailable: conflictPackage != nil
      )
      return RemoteWorkbook(
        metadata: resolvedMetadata,
        payloadFile: fileName,
        payloadHash: payloadHash,
        systemFields: encodeSystemFields(record),
        conflictPackage: conflictPackage
      )
    } catch {
      diskState.lastError = publicMessage(error)
      return nil
    }
  }

  private func metadata(from record: CKRecord) -> CloudWorkbookMetadata? {
    guard
      record.recordType == cavalryRecordType,
      let workbookId = normalizedWorkbookId(
        record.encryptedValues[.workbookId] as? String
      ),
      let name = normalizedName(record.encryptedValues[.name] as? String),
      let currency = normalizedCurrency(
        record.encryptedValues[.currency] as? String
      ),
      let revisionNumber = record.encryptedValues[.revision] as? NSNumber,
      let updatedAt = normalizedDate(
        record.encryptedValues[.sourceUpdatedAt] as? String
      )
    else { return nil }
    let revision = revisionNumber.intValue
    guard
      revision > 0,
      hashedRecordName(workbookId) == record.recordID.recordName
    else { return nil }
    let year = (record.encryptedValues[.year] as? NSNumber)?.intValue
    let notice = conflictNotice(from: record)
    return CloudWorkbookMetadata(
      id: workbookId,
      name: name,
      year: year,
      currency: currency,
      revision: revision,
      updatedAt: updatedAt,
      conflictNotice: notice
    )
  }

  private func conflictNotice(from record: CKRecord) -> CloudConflictNotice? {
    guard
      let id = normalizedConflictText(
        record.encryptedValues[.conflictId] as? String,
        maximum: 128
      ),
      let sourceDevice = normalizedConflictText(
        record.encryptedValues[.conflictSourceDevice] as? String,
        maximum: 40
      ),
      let detectedAt = normalizedDate(
        record.encryptedValues[.conflictDetectedAt] as? String
      ),
      let remoteRevisionNumber = record.encryptedValues[.conflictRemoteRevision] as? NSNumber,
      let summary = normalizedConflictText(
        record.encryptedValues[.conflictSummary] as? String,
        maximum: 240
      ),
      let report = normalizedConflictReport(
        record.encryptedValues[.conflictReport] as? String
      )
    else { return nil }
    let remoteRevision = remoteRevisionNumber.intValue
    guard remoteRevision > 0 else { return nil }
    let baseRevision = (record.encryptedValues[.conflictBaseRevision] as? NSNumber)?.intValue
    return CloudConflictNotice(
      id: id,
      sourceDevice: sourceDevice,
      detectedAt: detectedAt,
      baseRevision: baseRevision.flatMap { $0 > 0 ? $0 : nil },
      remoteRevision: remoteRevision,
      summary: summary,
      report: report,
      resolutionAvailable: false
    )
  }

  private func decodeConflictPackage(
    from record: CKRecord,
    recordName: String,
    noticeId: String?
  ) -> StoredConflictPackage? {
    guard
      let noticeId,
      let packageNoticeId = normalizedConflictText(
        record.encryptedValues[.conflictPackageNoticeId] as? String,
        maximum: 128
      ),
      packageNoticeId == noticeId,
      let sourceHash = record.encryptedValues[.conflictPayloadHash] as? String,
      let sourceAsset = record[.conflictPayloadAsset] as? CKAsset,
      let sourceURL = sourceAsset.fileURL
    else { return nil }
    let baseHash = record.encryptedValues[.conflictBasePayloadHash] as? String
    let baseAsset = record[.conflictBasePayloadAsset] as? CKAsset
    guard (baseHash == nil) == (baseAsset == nil) else { return nil }
    do {
      let sourceData = try Data(contentsOf: sourceURL)
      guard
        !sourceData.isEmpty,
        sourceData.count <= maximumPayloadBytes,
        sha256(sourceData) == sourceHash
      else { throw CloudStoreError.invalidPayload }
      let noticeHash = String(sha256(Data(noticeId.utf8)).prefix(20))
      let sourceFile = "remote-conflict-\(recordName)-\(noticeHash)-source.html"
      try sourceData.write(to: payloadURL(sourceFile), options: [.atomic])

      var baseFile: String?
      if let baseHash, let baseURL = baseAsset?.fileURL {
        let baseData = try Data(contentsOf: baseURL)
        guard
          !baseData.isEmpty,
          baseData.count <= maximumPayloadBytes,
          sha256(baseData) == baseHash
        else { throw CloudStoreError.invalidPayload }
        let fileName = "remote-conflict-\(recordName)-\(noticeHash)-base.html"
        try baseData.write(to: payloadURL(fileName), options: [.atomic])
        baseFile = fileName
      }
      return StoredConflictPackage(
        noticeId: noticeId,
        sourcePayloadFile: sourceFile,
        sourcePayloadHash: sourceHash,
        basePayloadFile: baseFile,
        basePayloadHash: baseHash
      )
    } catch {
      diskState.lastError = "The shared conflict details failed their integrity check."
      return nil
    }
  }

  private func latchConflict(
    recordName: String,
    workbookId: String,
    remoteRevision: Int?,
    remoteDeleted: Bool
  ) {
    diskState.conflicts[recordName] = WorkbookConflict(
      remoteRevision: remoteRevision,
      remoteDeleted: remoteDeleted,
      detectedAt: isoDate(Date())
    )
    removePendingPayload(recordName: recordName)
    diskState.pending.removeValue(forKey: recordName)
    engine?.state.remove(
      pendingRecordZoneChanges: [.saveRecord(recordID(recordName))]
    )
    if diskState.pendingConflictNotices?[recordName] != nil {
      engine?.state.add(
        pendingRecordZoneChanges: [.saveRecord(recordID(recordName))]
      )
    }
    emit(reason: "conflict", workbookId: workbookId)
  }

  private func revisionConflict() -> CloudKitBridgeResponse {
    .failure(
      "workbook_revision_conflict",
      "This workbook changed on another device. Review the iCloud copy before replacing either version.",
      conflict: true
    )
  }

  private func resetForAccountChange(
    accountRecordName: String?,
    preservePending: Bool = false
  ) {
    let retainedPending = preservePending ? diskState.pending : [:]
    let retainedPendingDeletes = preservePending ? diskState.pendingDeletes : []
    clearRemoteCache()
    if !preservePending {
      for recordName in diskState.pending.keys {
        removePendingPayload(recordName: recordName)
      }
    }
    for recordName in (diskState.pendingConflictNotices ?? [:]).keys {
      removePendingConflictPackage(recordName: recordName)
    }
    diskState = CloudKitDiskState()
    diskState.subscriptionIdentifier = cavalrySyncStateVersion
    diskState.accountRecordName = accountRecordName
    diskState.pending = retainedPending
    diskState.pendingDeletes = retainedPendingDeletes
    try? persist()
  }

  private func clearRemoteCache() {
    for recordName in diskState.remote.keys {
      removeRemotePayload(recordName: recordName)
    }
    diskState.remote.removeAll()
    diskState.conflicts.removeAll()
  }

  private func replaceRemote(recordName: String, with remote: RemoteWorkbook) {
    if let previous = diskState.remote[recordName] {
      if previous.payloadFile != remote.payloadFile {
        try? FileManager.default.removeItem(at: payloadURL(previous.payloadFile))
      }
      removeConflictPackageFiles(
        previous.conflictPackage,
        except: remote.conflictPackage
      )
    }
    diskState.remote[recordName] = remote
  }

  private func removeRemotePayload(recordName: String) {
    guard let remote = diskState.remote[recordName] else { return }
    try? FileManager.default.removeItem(at: payloadURL(remote.payloadFile))
    removeConflictPackageFiles(remote.conflictPackage)
  }

  private func removePendingPayload(recordName: String) {
    guard let file = diskState.pending[recordName]?.payloadFile else { return }
    try? FileManager.default.removeItem(at: payloadURL(file))
  }

  private func removePendingConflictPackage(recordName: String) {
    removeConflictPackageFiles(
      diskState.pendingConflictNotices?[recordName]?.conflictPackage
    )
  }

  private func removeConflictPackageFiles(
    _ package: StoredConflictPackage?,
    except retained: StoredConflictPackage? = nil
  ) {
    guard let package else { return }
    let retainedFiles = Set(
      [retained?.sourcePayloadFile, retained?.basePayloadFile].compactMap { $0 }
    )
    for fileName in [package.sourcePayloadFile, package.basePayloadFile].compactMap({ $0 })
    where !retainedFiles.contains(fileName) {
      try? FileManager.default.removeItem(at: payloadURL(fileName))
    }
  }

  private func storePendingConflictPackage(
    recordName: String,
    noticeId: String,
    sourcePortableHtml: String,
    basePortableHtml: String?
  ) throws -> StoredConflictPackage {
    let sourceData = Data(sourcePortableHtml.utf8)
    guard !sourceData.isEmpty, sourceData.count <= maximumPayloadBytes else {
      throw CloudStoreError.invalidPayload
    }
    let baseData = basePortableHtml.map { Data($0.utf8) }
    if let baseData {
      guard !baseData.isEmpty, baseData.count <= maximumPayloadBytes else {
        throw CloudStoreError.invalidPayload
      }
    }
    let noticeHash = String(sha256(Data(noticeId.utf8)).prefix(20))
    let generation = UUID().uuidString.lowercased()
    let sourceFile = "pending-conflict-\(recordName)-\(noticeHash)-\(generation)-source.html"
    let baseFile = baseData.map { _ in
      "pending-conflict-\(recordName)-\(noticeHash)-\(generation)-base.html"
    }
    do {
      try sourceData.write(to: payloadURL(sourceFile), options: [.atomic])
      if let baseData, let baseFile {
        try baseData.write(to: payloadURL(baseFile), options: [.atomic])
      }
      return StoredConflictPackage(
        noticeId: noticeId,
        sourcePayloadFile: sourceFile,
        sourcePayloadHash: sha256(sourceData),
        basePayloadFile: baseFile,
        basePayloadHash: baseData.map(sha256)
      )
    } catch {
      try? FileManager.default.removeItem(at: payloadURL(sourceFile))
      if let baseFile { try? FileManager.default.removeItem(at: payloadURL(baseFile)) }
      throw error
    }
  }

  private func readConflictPayload(
    fileName: String,
    expectedHash: String
  ) throws -> String {
    let data = try Data(contentsOf: payloadURL(fileName))
    guard
      !data.isEmpty,
      data.count <= maximumPayloadBytes,
      sha256(data) == expectedHash,
      let value = String(data: data, encoding: .utf8)
    else { throw CloudStoreError.invalidPayload }
    return value
  }

  private func conflictPackageFilesExist(_ package: StoredConflictPackage) -> Bool {
    guard FileManager.default.fileExists(atPath: payloadURL(package.sourcePayloadFile).path) else {
      return false
    }
    if let baseFile = package.basePayloadFile {
      return FileManager.default.fileExists(atPath: payloadURL(baseFile).path)
    }
    return package.basePayloadHash == nil
  }

  private func payloadURL(_ fileName: String) -> URL {
    payloadsURL.appendingPathComponent(fileName, isDirectory: false)
  }

  private func recordID(_ recordName: String) -> CKRecord.ID {
    CKRecord.ID(recordName: recordName, zoneID: zoneID)
  }

  private func persist() throws {
    try FileManager.default.createDirectory(
      at: payloadsURL,
      withIntermediateDirectories: true
    )
    let data = try JSONEncoder().encode(diskState)
    try data.write(to: stateURL, options: [.atomic])
  }

  private func emit(reason: String, workbookId: String? = nil) {
    var payload = ["reason": reason]
    if let workbookId { payload["workbookId"] = workbookId }
    eventSink?(payload)
  }
}

private enum CloudStoreError: Error {
  case engineUnavailable
  case invalidPayload
}

private func noticeWithResolutionAvailability(
  _ notice: CloudConflictNotice,
  resolutionAvailable: Bool
) -> CloudConflictNotice {
  CloudConflictNotice(
    id: notice.id,
    sourceDevice: notice.sourceDevice,
    detectedAt: notice.detectedAt,
    baseRevision: notice.baseRevision,
    remoteRevision: notice.remoteRevision,
    summary: notice.summary,
    report: notice.report,
    resolutionAvailable: resolutionAvailable
  )
}

private func cloudMetadata(
  _ metadata: CloudWorkbookMetadata,
  conflictResolutionAvailable: Bool
) -> CloudWorkbookMetadata {
  CloudWorkbookMetadata(
    id: metadata.id,
    name: metadata.name,
    year: metadata.year,
    currency: metadata.currency,
    revision: metadata.revision,
    updatedAt: metadata.updatedAt,
    conflict: metadata.conflict,
    pending: metadata.pending,
    conflictNotice: metadata.conflictNotice.map {
      noticeWithResolutionAvailability(
        $0,
        resolutionAvailable: conflictResolutionAvailable
      )
    }
  )
}

private func normalizedWorkbookId(_ value: String?) -> String? {
  guard let value else { return nil }
  let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
  guard
    normalized == value,
    !normalized.isEmpty,
    normalized.utf8.count <= 128,
    normalized.range(of: "^[A-Za-z0-9._:-]+$", options: .regularExpression) != nil
  else { return nil }
  return normalized
}

private func normalizedName(_ value: String?) -> String? {
  let normalized = (value ?? "")
    .replacingOccurrences(
      of: "[\\u{0000}-\\u{001F}\\u{007F}]", with: " ", options: .regularExpression
    )
    .trimmingCharacters(in: .whitespacesAndNewlines)
  guard !normalized.isEmpty else { return nil }
  return String(normalized.prefix(160))
}

private func normalizedCurrency(_ value: String?) -> String? {
  let normalized = (value ?? "")
    .trimmingCharacters(in: .whitespacesAndNewlines)
    .uppercased()
  guard normalized.range(of: "^[A-Z]{3,12}$", options: .regularExpression) != nil else {
    return nil
  }
  return normalized
}

private func normalizedDate(_ value: String?) -> String? {
  let normalized = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  guard !normalized.isEmpty, normalized.count <= 64 else { return nil }

  let fractionalFormatter = ISO8601DateFormatter()
  fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  let standardFormatter = ISO8601DateFormatter()
  guard
    fractionalFormatter.date(from: normalized) != nil
      || standardFormatter.date(from: normalized) != nil
  else { return nil }
  return normalized
}

private func normalizedConflictText(
  _ value: String?,
  maximum: Int
) -> String? {
  let normalized = (value ?? "")
    .replacingOccurrences(of: "[\\u0000-\\u001F\\u007F]", with: " ", options: .regularExpression)
    .trimmingCharacters(in: .whitespacesAndNewlines)
  guard !normalized.isEmpty, normalized.count <= maximum else { return nil }
  return normalized
}

private func normalizedConflictReport(_ value: String?) -> String? {
  guard let value, !value.isEmpty else { return nil }
  let data = Data(value.utf8)
  guard data.count <= maximumConflictReportBytes else { return nil }
  guard
    let decoded = try? JSONSerialization.jsonObject(with: data),
    decoded is [String: Any]
  else { return nil }
  return value
}

private func normalizedConflictNotice(
  _ notice: CloudConflictNotice,
  workbookId: String
) -> CloudConflictNotice? {
  guard
    let id = normalizedConflictText(notice.id, maximum: 128),
    id.range(of: "^[A-Za-z0-9._:-]+$", options: .regularExpression) != nil,
    let sourceDevice = normalizedConflictText(notice.sourceDevice, maximum: 40),
    let detectedAt = normalizedDate(notice.detectedAt),
    notice.remoteRevision > 0,
    notice.baseRevision == nil || notice.baseRevision! > 0,
    let summary = normalizedConflictText(notice.summary, maximum: 240),
    let report = normalizedConflictReport(notice.report),
    let reportData = report.data(using: .utf8),
    let reportObject = try? JSONSerialization.jsonObject(with: reportData) as? [String: Any],
    reportObject["workbookId"] as? String == workbookId
  else { return nil }
  return CloudConflictNotice(
    id: id,
    sourceDevice: sourceDevice,
    detectedAt: detectedAt,
    baseRevision: notice.baseRevision,
    remoteRevision: notice.remoteRevision,
    summary: summary,
    report: report,
    resolutionAvailable: notice.resolutionAvailable == true
  )
}

private func hashedRecordName(_ workbookId: String) -> String {
  "workbook_" + sha256(Data(workbookId.utf8))
}

private func sha256(_ data: Data) -> String {
  SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

private func isoDate(_ date: Date) -> String {
  ISO8601DateFormatter().string(from: date)
}

private func encodeSystemFields(_ record: CKRecord) -> Data {
  let archiver = NSKeyedArchiver(requiringSecureCoding: true)
  record.encodeSystemFields(with: archiver)
  archiver.finishEncoding()
  return archiver.encodedData
}

private func decodeSystemFields(_ data: Data) -> CKRecord? {
  do {
    let unarchiver = try NSKeyedUnarchiver(forReadingFrom: data)
    unarchiver.requiresSecureCoding = true
    defer { unarchiver.finishDecoding() }
    return CKRecord(coder: unarchiver)
  } catch {
    return nil
  }
}

private func cloudFailure(
  _ error: Error,
  fallbackCode: String
) -> CloudKitBridgeResponse {
  let cloudError = error as? CKError
  let code: String
  if cloudError?.code == .notAuthenticated {
    code = "icloud_account_unavailable"
  } else if cloudError?.code == .quotaExceeded || cloudError?.code == .limitExceeded {
    code = "cloud_quota_exceeded"
  } else if cloudError?.code == .serverRecordChanged {
    return .failure(
      "workbook_revision_conflict",
      "This workbook changed on another device. Review the iCloud copy before replacing either version.",
      conflict: true
    )
  } else {
    code = fallbackCode
  }
  return .failure(code, publicMessage(error))
}

private func publicMessage(_ error: Error) -> String {
  guard let cloudError = error as? CKError else {
    switch error {
    case CloudStoreError.engineUnavailable:
      return "The iCloud sync engine is not available yet."
    case CloudStoreError.invalidPayload:
      return "The iCloud workbook failed its integrity check."
    default:
      return "iCloud sync is temporarily unavailable. Cavalry will try again automatically."
    }
  }
  switch cloudError.code {
  case .notAuthenticated:
    return "Sign in to iCloud in Apple Settings to sync Cavalry."
  case .networkUnavailable, .networkFailure:
    return "Cavalry is offline. Your changes are saved locally and will sync later."
  case .quotaExceeded, .limitExceeded:
    return "Your iCloud storage cannot accept this workbook right now."
  case .serverRecordChanged:
    return "This workbook changed on another device. Review both versions before continuing."
  case .accountTemporarilyUnavailable, .serviceUnavailable, .zoneBusy,
    .requestRateLimited:
    return "iCloud is temporarily unavailable. Cavalry will retry automatically."
  default:
    return "iCloud sync could not finish. Your local workbook is unchanged."
  }
}
