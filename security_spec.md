# Security Specification — BATT PPMS Firestore Rules

## 1. Data Invariants

1. **Default-Deny Catch-All**: Unmatched paths are unconditionally denied (`allow read, write: if false`).
2. **Verified Identity**: All write operations require `request.auth != null` and `request.auth.token.email_verified == true`.
3. **Self-Assigned Role Prevention**: Regular users creating `/users/{userId}` can ONLY set `roleCode == 'VIEWER'` and `status == 'active'`. Only a verified administrator (`isAdmin()`) can assign elevated business roles (`OWNER`, `MANAGER`, `ADMIN_SYSTEM`, etc.).
4. **Master Gate Relational Sync**: Subcollections `/users/{userId}/private/{docId}` and `/users/{userId}/syncSnapshots/{snapshotId}` require parent `/users/{userId}` to exist with `status == 'active'`.
5. **PII Split Isolation**: Contact PII (`email`, `phone`) is isolated in `/users/{userId}/private/{docId}` and strictly readable only by `isOwner(userId)` or `isAdmin()`.
6. **Terminal State Locking**: Once `status` reaches `'suspended'`, `'revoked'`, or `'archived'`, regular users are blocked from further updates unless overridden by `isAdmin()`.
7. **Temporal & Key Integrity**: `createdAt` and `updatedAt` must equal `request.time`. Updates use `affectedKeys().hasOnly(...)` and preserve `uid`, `ownerId`, and `createdAt`.
8. **Secure List Enforcement**: All `allow list` rules check `resource.data.ownerId == request.auth.uid` without `get()` or `exists()` calls.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Privilege Escalation on Create**: `{ "uid": "u1", "displayName": "Attacker", "roleCode": "OWNER", "status": "active", "createdAt": "<SERVER_TIME>", "updatedAt": "<SERVER_TIME>" }` by non-admin `u1` → `PERMISSION_DENIED`.
2. **Shadow Ghost Field Injection**: `{ "uid": "u1", "displayName": "Valid", "roleCode": "VIEWER", "status": "active", "isSuperAdmin": true, "createdAt": "<SERVER_TIME>", "updatedAt": "<SERVER_TIME>" }` → `PERMISSION_DENIED`.
3. **Identity Spoofing on Create**: User `u1` writes `/users/u2` with `uid: "u2"` → `PERMISSION_DENIED`.
4. **Unverified Email Spoofing**: Token with `email: "locxuanpham2000@gmail.com"` and `email_verified: false` attempts admin write → `PERMISSION_DENIED`.
5. **PII Blanket Read Attack**: Authenticated user `u2` performs `get` on `/users/u1/private/info` → `PERMISSION_DENIED`.
6. **Orphaned Subcollection Write**: User `u1` creates `/users/u1/syncSnapshots/s1` when `/users/u1` does not exist or is `'suspended'` → `PERMISSION_DENIED`.
7. **Terminal State Unlock**: User `u1` updates `/users/u1/syncSnapshots/s1` after `status == 'archived'` → `PERMISSION_DENIED`.
8. **Immutable Field Mutation**: User `u1` updates `createdAt` or `ownerId` on `/users/u1/syncSnapshots/s1` → `PERMISSION_DENIED`.
9. **Client Timestamp Forgery**: User `u1` passes forged past/future timestamp in `updatedAt` instead of `request.time` → `PERMISSION_DENIED`.
10. **ID Poisoning**: Document ID of 500 characters or invalid symbols `../hack` → `PERMISSION_DENIED`.
11. **Value Poisoning**: Updating whitelisted `displayName` with an integer `12345` or 50KB string → `PERMISSION_DENIED`.
12. **Unauthorized Blanket List Scraping**: User `u2` lists `/users/u1/syncSnapshots` without matching `resource.data.ownerId == request.auth.uid` → `PERMISSION_DENIED`.
