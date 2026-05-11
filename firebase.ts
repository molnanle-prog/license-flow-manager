import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from './firebase-applet-config.json';
import { handleFirestoreError, OperationType } from './services/firebaseUtils';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

/**
 * Simple hash function for string
 */
const hashString = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
};

/**
 * Generates a device fingerprint based on browser properties
 */
export const getDeviceFingerprint = () => {
  const { userAgent, language, platform } = window.navigator;
  const { width, height, colorDepth } = window.screen;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  const rawId = `${userAgent}|${language}|${platform}|${width}x${height}|${colorDepth}|${timezone}`;
  return `fp-${hashString(rawId)}`;
};

/**
 * Records or updates an install log
 */
export const recordInstallLog = async (userId?: string) => {
  const deviceId = getDeviceFingerprint();
  const logRef = doc(db, 'install_logs', deviceId);
  
  try {
    // We try to get the doc first to see if it exists
    // Note: This might fail if the user is not an admin, 
    // but the rules allow create/update without read.
    // So we handle the error gracefully.
    let docSnap;
    try {
      docSnap = await getDoc(logRef);
    } catch (e) {
      // If we can't read, we'll just try to update/create blindly
      console.warn("Could not read install log (expected if not admin), proceeding with blind update");
    }

    const now = new Date().toISOString();
    
    if (!docSnap || !docSnap.exists()) {
      // Try to create
      try {
        await setDoc(logRef, {
          deviceId,
          isFallback: false,
          userId: userId || null,
          userAgent: window.navigator.userAgent,
          language: window.navigator.language,
          platform: (window.navigator as any).platform || 'unknown',
          screenResolution: `${window.screen.width}x${window.screen.height}`,
          installedAt: now,
          lastSeenAt: now
        }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `install_logs/${deviceId}`);
      }
    } else {
      // Update existing
      try {
        await setDoc(logRef, {
          lastSeenAt: now,
          userId: userId || docSnap.data().userId || null
        }, { merge: true });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `install_logs/${deviceId}`);
      }
    }
  } catch (error) {
    console.error("Error in recordInstallLog:", error);
  }
};

// Test connection
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is offline.");
    }
  }
}
testConnection();
