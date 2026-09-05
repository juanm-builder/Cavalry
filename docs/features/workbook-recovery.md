# Workbook storage and recovery

Cavalry keeps a local workbook on each device so you can continue working offline. iCloud is an
additional synchronized copy. Starting with Mac 2.2.9 and iPhone 1.0.1, both apps also retain recent
local saved versions to help recover from an interrupted or damaged save.

## Where to find your workbook

- **On Mac:** reopen Cavalry to resume the selected workbook. The startup screen's **Recent
  workbooks** includes the app's own library, labeled **Saved on this Mac**, as well as exported
  workbook files. Leaving a workbook clears the selection and keeps its saved copies.
- **On iPhone or iPad:** open Cavalry and use the workbook settings to switch among workbooks saved
  on the device. **Recovery copies** opens earlier local versions.
- **In iCloud:** open Cavalry's iCloud library on either device. A confirmed cloud workbook is stored
  in Cavalry's private CloudKit database. It does not appear as an ordinary file in Finder's iCloud
  Drive or the Files app. **Autosave with iCloud** updates that private library when the account,
  network, and iCloud service are available; a pending upload is not a confirmed cloud save.

To keep an independent file, use **Save Workbook As…** on Mac. On iPhone, choose **Files & Data →
Export Copy**, then **Save to Files** in the share sheet. Select iCloud Drive if you want that file
to be visible in Finder and Files. Exported HTML copies can be opened or imported by Cavalry on
either platform. An exported copy is a snapshot; subsequent edits are synchronized through Cavalry,
not by changing that exported snapshot on every device.

## If the workbook does not open

On Mac, retry opening the saved workbook or select it from **Recent workbooks**. Cavalry checks the
latest local copy and uses an earlier verified copy if necessary, showing a recovery notice. When
the latest copy is damaged, an older recovered version opens as a separate **(Recovered)** workbook
with iCloud autosave off. Recovery from a linked file's `.bak` backup follows the same rule. The
original local history and cloud workbook are preserved; review the recovered copy before adding
it to iCloud. A normal restart that opens the latest good saved copy keeps its identity and sync
link. If no copy can be read safely, Cavalry shows an error and retains the files instead of
treating the library as empty. An exported workbook can also be opened through **Open Workbook…**.

Cavalry also looks for readable snapshots left in its older local Production iCloud cache. These
can survive an earlier update problem even if the active workbook or browser cache is missing.
They are offered for explicit recovery from the Mac library; opening one creates a separate local
copy with iCloud autosave off. Discovery does not replace the active workbook or modify those old
cache files. A surviving cached copy may help recover earlier work, but data absent from every
local copy, export, backup, and iCloud record cannot be recreated by the update.

On iPhone, a failed local startup opens **Workbook recovery**. Use **Retry opening workbook** after
unlocking the device or freeing storage, select another saved workbook, or choose **Open recovery
copy**. A recovered version becomes a separate workbook named **(Recovered)**. Its original and
cloud copies are kept, and iCloud autosave stays off for the recovered copy until you review it and
explicitly add it to iCloud.

If a copy exists on your other device, open it there and export it before making further recovery
changes. Inspect Cavalry's iCloud library and the saved local workbooks on both devices. A missing
file in iCloud Drive alone does not mean the private Cavalry iCloud workbook was deleted.

## What the update preserves

The Mac library lives under
`~/Library/Application Support/Cavalry for Mac/Workbook Recovery`, outside the `.app` that updates
replace. Each workbook keeps up to 30 distinct recent validated HTML saves. An atomic per-workbook
record tracks their order independently of the system clock and filesystem timestamps. The iPhone repository
keeps the latest 10 distinct saved versions per workbook in its local database. Retention starts
with saves made by these versions; it cannot recreate historical copies that were never retained.

Existing workbook files and IDs remain compatible. Readable workbooks from the previous Mac cache
or saved file enter the durable library through normal saving. On iPhone, existing records and
their previous content enter recovery history when the next save commits. A missing index is
reconstructed from saved records; unreadable data is preserved for recovery. Upgrading does not
require reinstalling the app or deleting its data.

Mac update, quit, and reload requests wait for local saving. A save failure leaves the app open
with the workbook available so the problem can be resolved. iCloud sync can remain pending while
the local save succeeds. Local history stays on that device; CloudKit holds the current synchronized
snapshot, not a cloud version-history archive. Device loss, app-data deletion, and storage failure
still require a surviving cloud copy, export, or device backup.

## If the account references differ

Cavalry uses the Apple Account configured for **iCloud in system Settings**, which may differ from
the account used for App Store purchases. Both devices must use that same iCloud account and the
released Production apps. A Development build uses a separate test library and now labels it as
such. Sharing an App Store login alone does not establish that both private iCloud libraries match.

The Mac 2.2.7 release and iPhone 1.0.0 build 17 were inspected and use the same signed Production
container and Apple team. That establishes the build configuration, not the actual accounts on the
affected devices. If references still differ in the released apps, retain local copies and capture
the app versions, library environment labels, and account references for diagnosis. Never resolve
the difference by replacing private account IDs or deleting a local workbook.
