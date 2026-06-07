import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let firestoreDb;

export function initializeFirestore() {
  const firebaseApp = initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
  firestoreDb = getFirestore(firebaseApp);
}

export async function processFormResponses(User) {
  console.log('Reading applications from Firestore...');

  const snapshot = await firestoreDb.collection('applications').get();

  if (snapshot.empty) {
    console.log('No applications found');
    return [];
  }

  // Count occurrences of each ambassadorCode
  const counts = {};
  snapshot.forEach(doc => {
    const code = doc.data().ambassadorCode;
    if (code) {
      counts[code] = (counts[code] || 0) + 1;
    }
  });

  console.log('Counts:', counts);

  // Update MongoDB directly
  const results = await Promise.all(
    Object.entries(counts).map(async ([code, count]) => {
      try {
        const result = await User.updateOne(
          { referralCode: code },
          { $set: { referralCount: count } },
          { maxTimeMS: 5000 }
        );
        return { code, count, success: true, modified: result.modifiedCount };
      } catch (err) {
        console.error(`Failed to update ${code}:`, err);
        return { code, count, success: false, error: err.message };
      }
    })
  );

  console.log('Sync complete:', results);
  return results;
}
