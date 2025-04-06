const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// Create a new game room
exports.createRoom = functions.https.onCall(async (data, context) => {
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  
  await admin.firestore().collection('rooms').doc(roomId).set({
    hostId: roomId,
    status: 'waiting',
    players: [],
    gameStarted: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    signaling: {
      offers: {},
      answers: {},
      iceCandidates: {}
    }
  });

  return { roomId };
});

// Join an existing room
exports.joinRoom = functions.https.onCall(async (data, context) => {
  const { roomId, playerId } = data;
  
  const roomDoc = await admin.firestore().collection('rooms').doc(roomId).get();
  if (!roomDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Room not found');
  }

  const roomData = roomDoc.data();
  if (roomData.status !== 'waiting') {
    throw new functions.https.HttpsError('failed-precondition', 'Game already in progress');
  }

  // Add player to room
  await admin.firestore().collection('rooms').doc(roomId).update({
    players: [...roomData.players, playerId]
  });

  return { success: true };
});

// Handle WebRTC offer
exports.handleOffer = functions.https.onCall(async (data, context) => {
  const { roomId, playerId, offer } = data;
  
  await admin.firestore().collection('rooms').doc(roomId).update({
    [`signaling.offers.${playerId}`]: offer
  });

  return { success: true };
});

// Handle WebRTC answer
exports.handleAnswer = functions.https.onCall(async (data, context) => {
  const { roomId, playerId, answer } = data;
  
  await admin.firestore().collection('rooms').doc(roomId).update({
    [`signaling.answers.${playerId}`]: answer
  });

  return { success: true };
});

// Handle ICE candidates
exports.handleIceCandidate = functions.https.onCall(async (data, context) => {
  const { roomId, playerId, candidate } = data;
  
  await admin.firestore().collection('rooms').doc(roomId).update({
    [`signaling.iceCandidates.${playerId}`]: admin.firestore.FieldValue.arrayUnion(candidate)
  });

  return { success: true };
});

// Start the game
exports.startGame = functions.https.onCall(async (data, context) => {
  const { roomId } = data;
  
  await admin.firestore().collection('rooms').doc(roomId).update({
    gameStarted: true,
    status: 'playing',
    startTime: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true };
});

// Handle game results
exports.submitScore = functions.https.onCall(async (data, context) => {
  const { roomId, playerId, score } = data;
  
  const roomRef = admin.firestore().collection('rooms').doc(roomId);
  const roomDoc = await roomRef.get();
  const roomData = roomDoc.data();

  // Update player's score
  await roomRef.update({
    [`scores.${playerId}`]: score,
    [`submissions.${playerId}`]: true
  });

  // Check if both players have submitted scores
  const submissions = roomData.submissions || {};
  if (Object.keys(submissions).length === 2) {
    const scores = roomData.scores;
    const winnerId = Object.entries(scores).reduce((a, b) => a[1] > b[1] ? a : b)[0];
    
    await roomRef.update({
      status: 'completed',
      winnerId,
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  return { success: true };
}); 