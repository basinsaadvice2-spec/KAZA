import { createHash } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions/logger';
import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { matchesSavedSearch } from './criteria.js';

initializeApp();
const db = getFirestore();
const INVALID_FID_CODES = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

function stableId(namespace, key) {
  return `${namespace}_${createHash('sha256').update(key).digest('hex').slice(0, 48)}`;
}

async function createNotification(key, values) {
  if (!values.toUid || !values.type || !values.title || !values.body) return false;
  const id = stableId('kaza', key);
  const reference = db.collection('notifications').doc(id);
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    if (existing.exists) return false;
    transaction.set(reference, {
      ...values,
      title: String(values.title).slice(0, 120),
      body: String(values.body).slice(0, 500),
      read: false,
      createdAt: FieldValue.serverTimestamp()
    });
    return true;
  });
}

function pushCopy(type) {
  const copy = {
    listings: ['Nouvelle annonce KAZA', 'Une annonce correspond à vos critères enregistrés.'],
    followedListings: ['Logement suivi mis à jour', 'Une annonce que vous suivez a changé.'],
    booking: ['Mise à jour de votre logement', 'Une demande ou une location a évolué.'],
    chat: ['Nouveau message KAZA', 'Vous avez reçu un message. Ouvrez KAZA pour le consulter.'],
    payment: ['Mise à jour de paiement', 'Une opération de paiement a évolué.'],
    activity: ['Activité KAZA', 'Une activité importante vous concerne.']
  };
  return copy[type] || copy.activity;
}

async function sendPushForNotification(event) {
  const notification = event.data?.data();
  if (!notification?.toUid || !notification.type) return;
  const userRef = db.collection('users').doc(notification.toUid);
  const notificationRef = event.data.ref;
  const claim = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(notificationRef);
    if (!snapshot.exists) return false;
    const data = snapshot.data();
    const lockAt = data.pushLockAt?.toDate?.().getTime() || 0;
    if (data.pushStatus === 'sent' || data.pushStatus === 'skipped') return false;
    if (data.pushStatus === 'sending' && Date.now() - lockAt < 5 * 60 * 1000) return false;
    transaction.update(notificationRef, {
      pushStatus: 'sending',
      pushLockAt: FieldValue.serverTimestamp(),
      pushAttempts: FieldValue.increment(1)
    });
    return true;
  });
  if (!claim) return;

  try {
    const userSnapshot = await userRef.get();
    const prefs = userSnapshot.data()?.notificationPrefs?.categories || {};
    if (!userSnapshot.exists || prefs[notification.type] === false) {
      await notificationRef.update({ pushStatus: 'skipped', pushFinishedAt: FieldValue.serverTimestamp() });
      return;
    }
    const tokenSnapshot = await userRef.collection('pushTokens').where('enabled', '==', true).get();
    const devices = tokenSnapshot.docs.map((item) => ({ reference: item.ref, fid: item.data().fid })).filter((item) => item.fid);
    if (!devices.length) {
      await notificationRef.update({ pushStatus: 'skipped', pushFinishedAt: FieldValue.serverTimestamp() });
      return;
    }

    const [title, body] = pushCopy(notification.type);
    const data = {
      title,
      body,
      type: String(notification.type),
      notificationId: event.params.notificationId,
      tab: String(notification.tab || ''),
      chatId: String(notification.chatId || ''),
      aptId: String(notification.aptId || '')
    };
    let recoverableFailure = false;
    for (let offset = 0; offset < devices.length; offset += 500) {
      const group = devices.slice(offset, offset + 500);
      const result = await getMessaging().sendEachForMulticast({
        fids: group.map((item) => item.fid),
        data,
        webpush: { headers: { TTL: '86400' } }
      });
      const removals = [];
      result.responses.forEach((response, index) => {
        if (response.success) return;
        const code = response.error?.code || '';
        if (INVALID_FID_CODES.has(code)) removals.push(group[index].reference.delete());
        else recoverableFailure = true;
        logger.warn('KAZA push send failed', { code, notificationId: event.params.notificationId });
      });
      await Promise.allSettled(removals);
    }
    if (recoverableFailure) throw new Error('At least one FCM delivery failed.');
    await notificationRef.update({ pushStatus: 'sent', pushSentAt: FieldValue.serverTimestamp() });
  } catch (error) {
    await notificationRef.update({
      pushStatus: 'retry',
      pushLastError: String(error.code || error.message || 'push-error').slice(0, 160)
    }).catch(() => {});
    logger.error('KAZA push delivery failed', error);
    throw error;
  }
}

export const deliverNotificationPush = onDocumentCreated(
  { document: 'notifications/{notificationId}', retry: true },
  sendPushForNotification
);

export const notifyMatchingTenants = onDocumentCreated(
  { document: 'apartments/{apartmentId}', retry: true },
  async (event) => {
  const apartment = event.data?.data();
  if (!apartment || apartment.status !== 'Disponible') return;
  const tenants = await db.collection('users').where('role', '==', 'tenant').get();
  const work = tenants.docs.map(async (tenant) => {
    const profile = tenant.data();
    if (!profile.savedSearch || !matchesSavedSearch(apartment, profile.savedSearch)) return;
    await createNotification(`${event.id}:listing:${tenant.id}`, {
      toUid: tenant.id,
      fromUid: apartment.ownerUid || 'system',
      type: 'listings',
      title: 'Nouvelle annonce correspondant à votre recherche',
      body: `${apartment.title || 'Un logement'} est disponible à ${apartment.commune || 'Kinshasa'}.`,
      aptId: event.params.apartmentId,
      tab: 'catalog'
    });
  });
  const results = await Promise.allSettled(work);
  const failures = results.filter((result) => result.status === 'rejected');
  failures.forEach((result) => logger.warn('Annonce non notifiée', result.reason));
  if (failures.length) throw new Error(`${failures.length} notification(s) d'annonce n'ont pas été créées.`);
  }
);

export const notifyChatMessage = onDocumentCreated(
  { document: 'chats/{chatId}/messages/{messageId}', retry: true },
  async (event) => {
  const message = event.data?.data();
  if (!message?.senderUid) return;
  const chatSnapshot = await db.collection('chats').doc(event.params.chatId).get();
  if (!chatSnapshot.exists) return;
  const chat = chatSnapshot.data();
  if (!Array.isArray(chat.participants) || !chat.participants.includes(message.senderUid)) return;
  const recipients = chat.participants.filter((uid) => uid && uid !== message.senderUid);
  const results = await Promise.all(recipients.map(async (uid) => {
    const profile = await db.collection('users').doc(uid).get();
    const tab = profile.data()?.role === 'owner' ? 'owner-chats' : 'tenant-chats';
    return createNotification(`${event.id}:chat:${uid}`, {
      toUid: uid,
      fromUid: message.senderUid,
      type: 'chat',
      title: `Message de ${message.senderName || 'KAZA'}`,
      body: String(message.text || 'Vous avez reçu un nouveau message.').slice(0, 160),
      chatId: event.params.chatId,
      aptId: chat.aptId || '',
      tab
    });
  }));
  return results;
  }
);

export const notifyPaymentCreated = onDocumentCreated(
  { document: 'payments/{paymentId}', retry: true },
  async (event) => {
  const payment = event.data?.data();
  if (!payment?.tenantUid || !payment.ownerUid || payment.status !== 'En attente') return;
  return createNotification(`${event.id}:payment-created`, {
    toUid: payment.ownerUid,
    fromUid: payment.tenantUid,
    type: 'payment',
    title: 'Paiement déclaré',
    body: `${payment.tenantName || 'Un locataire'} a déclaré un paiement pour ${payment.period || 'une période'}.`,
    aptId: payment.aptId || '',
    paymentId: event.params.paymentId,
    tab: 'owner-payments'
  });
  }
);

export const notifyPaymentUpdated = onDocumentUpdated(
  { document: 'payments/{paymentId}', retry: true },
  async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.status === after.status || !['Validé', 'Refusé'].includes(after.status)) return;
  return createNotification(`${event.id}:payment-updated`, {
    toUid: after.tenantUid,
    fromUid: after.ownerUid,
    type: 'payment',
    title: after.status === 'Validé' ? 'Paiement validé' : 'Paiement refusé',
    body: after.status === 'Validé'
      ? `Votre paiement de ${after.period || ''} a été validé. La quittance est disponible.`
      : `Votre paiement de ${after.period || ''} a été refusé.${after.refusalReason ? ` Motif : ${after.refusalReason}` : ''}`,
    aptId: after.aptId || '',
    paymentId: event.params.paymentId,
    tab: 'my-rental'
  });
  }
);

export const notifyApartmentActivity = onDocumentUpdated(
  { document: 'apartments/{apartmentId}', retry: true },
  async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  const apartmentId = event.params.apartmentId;
  const notices = [];

  if (before.status === 'Disponible' && after.status === 'Réservé' && after.tenantUid) {
    notices.push(createNotification(`${event.id}:booking-request`, {
      toUid: after.ownerUid,
      fromUid: after.tenantUid,
      type: 'booking',
      title: 'Nouvelle demande de réservation',
      body: `${after.tenantName || 'Un locataire'} souhaite réserver ${after.title || 'un logement'}.`,
      aptId: apartmentId,
      tab: 'owner-apparts'
    }));
  }
  if (before.status === 'Réservé' && after.status === 'Loué' && after.tenantUid) {
    notices.push(createNotification(`${event.id}:booking-confirmed`, {
      toUid: after.tenantUid,
      fromUid: after.ownerUid,
      type: 'booking',
      title: 'Réservation confirmée',
      body: `Votre location de ${after.title || 'ce logement'} est confirmée.`,
      aptId: apartmentId,
      tab: 'my-rental'
    }));
  }
  if (before.status === 'Réservé' && after.status === 'Disponible' && before.tenantUid) {
    notices.push(createNotification(`${event.id}:booking-closed`, {
      toUid: before.tenantUid,
      fromUid: after.ownerUid || 'system',
      type: 'booking',
      title: 'Demande de réservation clôturée',
      body: `La demande concernant ${before.title || 'ce logement'} n’est plus en attente.`,
      aptId: apartmentId,
      tab: 'catalog'
    }));
  }
  if (!before.departureRequested && after.departureRequested && after.tenantUid) {
    notices.push(createNotification(`${event.id}:departure-request`, {
      toUid: after.ownerUid,
      fromUid: after.tenantUid,
      type: 'booking',
      title: 'Départ signalé par un locataire',
      body: `${after.tenantName || 'Un locataire'} signale son départ pour ${after.title || 'un logement'}.`,
      aptId: apartmentId,
      tab: 'owner-apparts'
    }));
  }
  if (before.status === 'Loué' && after.status === 'Disponible' && before.tenantUid) {
    notices.push(createNotification(`${event.id}:departure-complete`, {
      toUid: before.tenantUid,
      fromUid: after.ownerUid,
      type: 'booking',
      title: 'Logement libéré',
      body: `La location de ${before.title || 'votre logement'} est clôturée.`,
      aptId: apartmentId,
      tab: 'my-rental'
    }));
  }

  const trackedFields = [
    'status', 'title', 'price', 'rates', 'reference', 'avenue', 'landmark', 'commune',
    'type', 'snel', 'water', 'garantie', 'mapsUrl', 'photos', 'photoUrl',
    'propertyNumber', 'unitNumber', 'buildingName'
  ];
  const changed = trackedFields.some((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null));
  if (changed) {
    const followers = await db.collection('apartments').doc(apartmentId).collection('followers').get();
    for (const follower of followers.docs) {
      const uid = follower.id;
      if (!uid || uid === after.ownerUid || uid === after.tenantUid) continue;
      notices.push(createNotification(`${event.id}:followed:${uid}`, {
        toUid: uid,
        fromUid: after.ownerUid || 'system',
        type: 'followedListings',
        title: 'Un logement que vous suivez a changé',
        body: `${after.title || before.title || 'Une annonce'} a été mise à jour.`,
        aptId: apartmentId,
        tab: 'catalog'
      }));
    }
  }

  const results = await Promise.allSettled(notices);
  const failures = results.filter((result) => result.status === 'rejected');
  failures.forEach((result) => logger.warn('Événement logement non notifié', result.reason));
  if (failures.length) throw new Error(`${failures.length} notification(s) de logement n'ont pas été créées.`);
  }
);

export const notifyFollowedListingRemoved = onDocumentDeleted(
  { document: 'apartments/{apartmentId}', retry: true },
  async (event) => {
  const apartment = event.data?.data();
  if (!apartment) return;
  const apartmentId = event.params.apartmentId;
  const followers = await db.collection('apartments').doc(apartmentId).collection('followers').get();
  const tasks = followers.docs.map(async (follower) => {
    await createNotification(`${event.id}:followed-removed:${follower.id}`, {
      toUid: follower.id,
      fromUid: apartment.ownerUid || 'system',
      type: 'followedListings',
      title: 'Annonce retirée',
      body: `${apartment.title || 'Un logement que vous suiviez'} a été retiré de KAZA.`,
      aptId: apartmentId,
      tab: 'catalog'
    });
    await db.collection('users').doc(follower.id).collection('followedApartments').doc(apartmentId).delete().catch(() => {});
    await follower.ref.delete().catch(() => {});
  });
  const results = await Promise.allSettled(tasks);
  const failures = results.filter((result) => result.status === 'rejected');
  failures.forEach((result) => logger.warn('Annonce retirée, notification incomplète', result.reason));
  if (failures.length) throw new Error(`${failures.length} notification(s) de suppression n'ont pas été créées.`);
  }
);
