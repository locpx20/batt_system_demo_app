import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export async function signInWithGooglePopup(): Promise<{ email: string; displayName: string; uid: string }> {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  const user = cred.user;

  if (user.emailVerified && user.uid) {
    const userPath = `users/${user.uid}`;
    try {
      const existingSnap = await getDocFromServer(doc(db, 'users', user.uid));
      if (!existingSnap.exists()) {
        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid.slice(0, 128),
          displayName: (user.displayName || user.email || 'Người dùng BATT').slice(0, 100),
          roleCode: 'VIEWER',
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Missing or insufficient permissions')) {
        handleFirestoreError(err, OperationType.WRITE, userPath);
      }
    }
  }

  return {
    email: user.email || '',
    displayName: user.displayName || '',
    uid: user.uid,
  };
}

export async function syncFirebaseRouteSnapshot(lastRoute: string): Promise<void> {
  const current = auth.currentUser;
  if (!current || !current.emailVerified) return;
  const safeRoute = lastRoute.slice(0, 120) || '/tong-quan';
  const snapPath = `users/${current.uid}/syncSnapshots/current`;
  try {
    const existing = await getDocFromServer(
      doc(db, 'users', current.uid, 'syncSnapshots', 'current')
    );
    if (!existing.exists()) {
      await setDoc(doc(db, 'users', current.uid, 'syncSnapshots', 'current'), {
        ownerId: current.uid,
        lastRoute: safeRoute,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (existing.data()?.status === 'active') {
      await setDoc(
        doc(db, 'users', current.uid, 'syncSnapshots', 'current'),
        {
          ownerId: current.uid,
          lastRoute: safeRoute,
          status: 'active',
          createdAt: existing.data()?.createdAt,
          updatedAt: serverTimestamp(),
        }
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Missing or insufficient permissions')) {
      handleFirestoreError(err, OperationType.WRITE, snapPath);
    }
  }
}

export async function signOutFirebaseIfActive(): Promise<void> {
  if (auth.currentUser) {
    await signOut(auth);
  }
}
