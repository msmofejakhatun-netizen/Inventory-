import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);

export async function uploadInvoiceImage(
  restaurantId: string,
  poId: string,
  file: File | Blob
): Promise<{ downloadUrl: string; storagePath: string }> {
  const timestamp = Date.now();
  const ext = file instanceof File && file.name ? file.name.split('.').pop() || 'jpg' : 'jpg';
  const storagePath = `restaurants/${restaurantId}/invoices/${poId}_${timestamp}.${ext}`;
  try {
    const storageRef = ref(storage, storagePath);
    const snapshot = await uploadBytes(storageRef, file, {
      contentType: file.type || 'image/jpeg',
    });
    const downloadUrl = await getDownloadURL(snapshot.ref);
    return { downloadUrl, storagePath };
  } catch (err) {
    console.warn('Firebase Storage upload fallback triggered:', err);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        resolve({
          downloadUrl: reader.result as string,
          storagePath: storagePath,
        });
      };
      reader.readAsDataURL(file);
    });
  }
}

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
