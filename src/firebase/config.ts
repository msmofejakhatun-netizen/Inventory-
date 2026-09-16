import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export async function validateFirebaseConnection(): Promise<{ ok: boolean; message?: string }> {
  try {
    // Testing connection to server
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is offline. Please check your network or Firebase configuration.');
      return { ok: false, message: 'Firebase client is offline. Please check your network or configuration.' };
    }
    // Permission denied or missing doc is normal for a test collection, meaning the server responded!
    return { ok: true };
  }
}

export { firebaseConfig };
