import Foundation

// Test doubles reproduce CKSyncEngine's documented queue reset on account
// events. They never instantiate CloudKit, authenticate, or touch user data.
// The runner inserts unchanged production method bodies into this actor.
private struct CKRecordZone: Hashable {
  let zoneID: String
}

private final class CKSyncEngine: @unchecked Sendable {
  enum DatabaseChange: Hashable { case saveZone(CKRecordZone) }
  enum RecordChange: Hashable { case saveRecord(String), deleteRecord(String) }
  final class State {
    var database = Set<DatabaseChange>()
    var records = Set<RecordChange>()
    func add(pendingDatabaseChanges: [DatabaseChange]) { database.formUnion(pendingDatabaseChanges) }
    func add(pendingRecordZoneChanges: [RecordChange]) { records.formUnion(pendingRecordZoneChanges) }
    func resetForAccountEvent() { database.removeAll(); records.removeAll() }
  }
  let state = State()
  func cancelOperations() async {}
}

private struct UserRecord: Sendable { let recordName: String }
private enum AccountChange: Sendable {
  case signIn(UserRecord), signOut, switchAccounts(UserRecord, UserRecord)
}
private struct AccountEvent: Sendable { let changeType: AccountChange }
private struct DiskState {
  var accountRecordName: String?
  var zoneReady = false
  var pending: [String: Bool]
  var pendingConflictNotices: [String: Bool]?
  var pendingDeletes: Set<String>
  init(_ owner: String) {
    accountRecordName = owner
    pending = ["save-\(owner)": true]
    pendingConflictNotices = ["notice-\(owner)": true]
    pendingDeletes = ["delete-\(owner)"]
  }
}

private actor StoreFixture {
  var verifiedAccountId: String? = "A"
  var accountCheckEpoch = 0
  var ownerEpoch = 0
  var accountTask: Task<Void, Never>?
  var accountTaskId: UUID?
  var syncTask: Task<Void, Error>?
  var sendTask: Task<Void, Error>?
  var syncEnabled = true
  var engine: CKSyncEngine?
  var diskState = DiskState("A")
  let zoneID = "workbooks"
  func recordID(_ name: String) -> String { name }
  func emit(reason: String) {}
  // Selecting actual owner directories is covered separately by the compiled
  // production real-filesystem durability tests. These tests target callbacks.
  func prepareEngine() async {}

  // INSERT_PRODUCTION_SEED
  // INSERT_PRODUCTION_STOP

  func handleAccountEvent(_ event: AccountEvent, syncEngine: CKSyncEngine) async {
    // The runner verifies this guard still exists in production handleEvent.
    guard engine === syncEngine else { return }
    // INSERT_PRODUCTION_ACCOUNT_EVENT
  }

  func checkQueue(_ target: CKSyncEngine, owner: String) {
    precondition(target.state.database == [.saveZone(CKRecordZone(zoneID: zoneID))])
    precondition(target.state.records == [.saveRecord("save-\(owner)"), .saveRecord("notice-\(owner)"), .deleteRecord("delete-\(owner)")])
    precondition(diskState.pending == ["save-\(owner)": true])
    precondition(diskState.pendingDeletes == ["delete-\(owner)"])
  }

  func run() async {
    let a = CKSyncEngine()
    engine = a
    seedPendingChanges(into: a)
    checkQueue(a, owner: "A")
    let initialEpoch = ownerEpoch
    for _ in 0..<3 {
      a.state.resetForAccountEvent()
      await handleAccountEvent(AccountEvent(changeType: .signIn(UserRecord(recordName: "A"))), syncEngine: a)
      checkQueue(a, owner: "A")
      precondition(engine === a && ownerEpoch == initialEpoch, "Same-owner startup recreated the engine")
    }

    syncEnabled = false
    a.state.resetForAccountEvent()
    await handleAccountEvent(AccountEvent(changeType: .signIn(UserRecord(recordName: "A"))), syncEngine: a)
    precondition(a.state.records.isEmpty && a.state.database.isEmpty, "Paused sync was re-seeded")
    syncEnabled = true

    diskState.accountRecordName = "B"
    await handleAccountEvent(AccountEvent(changeType: .signIn(UserRecord(recordName: "A"))), syncEngine: a)
    precondition(a.state.records.isEmpty && a.state.database.isEmpty, "Wrong owner's outbox was re-seeded")
    diskState.accountRecordName = "A"
    let savedA = diskState

    await handleAccountEvent(AccountEvent(changeType: .switchAccounts(UserRecord(recordName: "A"), UserRecord(recordName: "B"))), syncEngine: a)
    precondition(engine == nil && verifiedAccountId == nil && ownerEpoch > initialEpoch)
    precondition(diskState.accountRecordName == "A", "Account event replaced A before verification")
    let b = CKSyncEngine()
    diskState = DiskState("B")
    verifiedAccountId = "B"
    engine = b
    await handleAccountEvent(AccountEvent(changeType: .signIn(UserRecord(recordName: "B"))), syncEngine: b)
    checkQueue(b, owner: "B")
    let bEpoch = ownerEpoch
    await handleAccountEvent(AccountEvent(changeType: .signOut), syncEngine: a)
    precondition(engine === b && verifiedAccountId == "B" && ownerEpoch == bEpoch, "Stale A callback changed B")
    checkQueue(b, owner: "B")
    let savedB = diskState

    await handleAccountEvent(AccountEvent(changeType: .switchAccounts(UserRecord(recordName: "B"), UserRecord(recordName: "A"))), syncEngine: b)
    precondition(engine == nil && verifiedAccountId == nil)
    let returningA = CKSyncEngine()
    diskState = savedA
    verifiedAccountId = "A"
    engine = returningA
    await handleAccountEvent(AccountEvent(changeType: .signIn(UserRecord(recordName: "A"))), syncEngine: returningA)
    checkQueue(returningA, owner: "A")
    precondition(savedB.pending == ["save-B": true] && savedB.pendingDeletes == ["delete-B"])
    await handleAccountEvent(AccountEvent(changeType: .signOut), syncEngine: returningA)
    precondition(engine == nil && verifiedAccountId == nil && diskState.pending == savedA.pending)
    print("PASS: production account-event methods restore same-owner queues without engine recreation, respect pause and ownership, ignore stale callbacks, and preserve A/B/A outboxes")
  }
}

@main struct AccountEventTests {
  static func main() async { await StoreFixture().run() }
}
