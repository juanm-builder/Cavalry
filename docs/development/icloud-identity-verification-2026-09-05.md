# iCloud account identity and release verification

Both apps derive the displayed account reference from the same native CloudKit user record ID: remove one leading underscore, take the last 12 characters, and uppercase them. Neither device generates its own account ID. Matching-ID regression coverage uses the same fixture on Mac and iPhone. The real private account ID continues to scope saved sync state; a display reference is never used to grant access or merge accounts.

An Apple Account can have separate CloudKit libraries in Development and Production. CloudKit does not copy user records when deploying a schema, and TestFlight uses Production. Both apps must use `iCloud.com.juanmbuilder.cavalry`, Production, and the same Apple Account in device Settings to share their library. See Apple's [CloudKit account model](https://developer.apple.com/documentation/cloudkit/ckcontainer), [environment separation](https://developer.apple.com/icloud/cloudkit/designing/), and [TestFlight environment rules](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitQuickStart/TestingYourApp/TestingYourApp.html).

The installed Mac 2.2.6, downloaded GitHub 2.2.7 release, and iOS 1.0.0 (17) production IPA all have effective signed Production entitlements for the shared container and team `U8H23USGUJ`; their native Info.plist also declares Production. The latest release pair is therefore not split by environment. This does not establish the configuration of either affected user's device or confirm a live account match.

## Changes

- Mac resolves the effective signed CloudKit environment before selecting its cache and reporting account status. Info.plist is only the fallback for unsigned development tools; missing or malformed configuration can no longer silently claim Production.
- Both apps identify Development as a separate test library and explain how to use the released Mac app with TestFlight. Production account references retain their existing format.
- Mobile preview and production EAS profiles reject an explicit Development override. Generated native verification also checks both the configured runtime container and the entitlement container, in addition to their environments.
- The iPhone account provider exposes the native environment so the account screen cannot describe a Development library as the ordinary private library.

## Validation and remaining device checks

Focused verification passed: 30 Mac settings interaction tests, 52 iOS account/library tests, 43 native build-script tests, native Mac Swift typechecking, iOS TypeScript, and targeted linting. The real Mac host-to-renderer model and iOS native-boundary-to-session paths also preserve the full matching raw owner ID. Release inspection must check the final signed IPA as well as its managed Expo configuration, because export signing can change entitlements.

Matching account references cannot be honestly guaranteed without verifying both affected devices' OS iCloud accounts and final installed builds. No workaround replaces CloudKit user IDs with a shared constant or device-derived identity. A live two-device Production upload/download remains the decisive end-to-end check.
