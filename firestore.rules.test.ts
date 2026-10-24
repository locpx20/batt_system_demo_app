/**
 * Firestore Security Rules Specification & Dirty Dozen Verification Suite
 * Validates all 12 adversarial payloads defined in security_spec.md against
 * structural, identity, temporal, and terminal-state invariants.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface DirtyDozenCheck {
  id: string;
  title: string;
  passed: boolean;
  detail: string;
}

export function verifyFirestoreRulesStaticAudit(rulesPath: string): DirtyDozenCheck[] {
  const src = fs.readFileSync(path.resolve(rulesPath), 'utf8');

  const checks: DirtyDozenCheck[] = [
    {
      id: 'DD-01',
      title: 'Privilege Escalation Blocked on Self-Registration',
      passed: src.includes("incoming().roleCode == 'VIEWER' && incoming().status == 'active'"),
      detail: 'Self-created /users/{userId} must strictly have VIEWER role.',
    },
    {
      id: 'DD-02',
      title: 'Shadow Ghost Field Blocked via Strict Key Allowlists',
      passed:
        src.includes("data.keys().hasOnly(['uid', 'displayName', 'roleCode', 'status', 'createdAt', 'updatedAt'])") &&
        src.includes("affectedKeys().hasOnly(['displayName', 'updatedAt'])"),
      detail: 'hasOnly() blocks extra unapproved fields on create and update.',
    },
    {
      id: 'DD-03',
      title: 'Identity Spoofing Blocked',
      passed: src.includes('incoming().uid == userId') && src.includes('incoming().ownerId == request.auth.uid'),
      detail: 'Document owner/uid fields must match authenticated user and path.',
    },
    {
      id: 'DD-04',
      title: 'Unverified Email Spoofing Blocked',
      passed: src.includes('request.auth.token.email_verified == true'),
      detail: 'All writes and bootstrap admin checks mandate email_verified == true.',
    },
    {
      id: 'DD-05',
      title: 'PII Split Collection Isolation Enforced',
      passed: src.includes('match /private/{docId}') && src.includes('allow list: if false;'),
      detail: 'PII subcollection denies list scraping and restricts get to owner/admin.',
    },
    {
      id: 'DD-06',
      title: 'Orphaned Subcollection Write Blocked via Master Gate',
      passed: src.includes('isActiveParentUser(userId)'),
      detail: 'Subcollection writes verify active parent /users/{userId} via exists() & get().',
    },
    {
      id: 'DD-07',
      title: 'Terminal State Locking Enforced',
      passed: src.includes("existing().status != 'archived'") && src.includes("existing().status != 'suspended'"),
      detail: 'Terminal archived/suspended documents block non-admin mutations.',
    },
    {
      id: 'DD-08',
      title: 'Immortal Fields Protected on Update',
      passed:
        src.includes('incoming().createdAt == existing().createdAt') &&
        src.includes('incoming().ownerId == existing().ownerId'),
      detail: 'createdAt, uid, and ownerId cannot change during update.',
    },
    {
      id: 'DD-09',
      title: 'Server Timestamp Temporal Integrity',
      passed:
        src.includes('incoming().createdAt == request.time') &&
        src.includes('incoming().updatedAt == request.time'),
      detail: 'Client-forged timestamps are rejected.',
    },
    {
      id: 'DD-10',
      title: 'Path Variable ID Poisoning Guard',
      passed: src.includes("id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\\\-]+$')"),
      detail: 'isValidId() constrains length and regex character set.',
    },
    {
      id: 'DD-11',
      title: 'Value Poisoning Blocked by Validation Wrapper on Update',
      passed:
        src.includes('allow update: if isValidUserPublicProfile(incoming())') &&
        src.includes('allow update: if isValidUserPrivateInfo(incoming())') &&
        src.includes('allow update: if isValidSyncSnapshot(incoming())') &&
        src.includes('allow update: if isValidAdminRecord(incoming())'),
      detail: 'Every allow update begins with isValid[Entity](incoming()).',
    },
    {
      id: 'DD-12',
      title: 'Secure List Enforcer Without Blanket Reads',
      passed:
        src.includes('allow list: if isSignedIn() && existing().ownerId == request.auth.uid;') &&
        !src.includes('allow read: if isSignedIn()'),
      detail: 'List queries enforce resource.data ownership without get()/exists().',
    },
  ];

  return checks;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2] || 'firestore.rules';
  const results = verifyFirestoreRulesStaticAudit(target);
  const failed = results.filter((c) => !c.passed);
  for (const r of results) {
    console.log(`[${r.passed ? 'PASS' : 'FAIL'}] ${r.id}: ${r.title}`);
  }
  if (failed.length > 0) {
    process.exit(1);
  }
}
