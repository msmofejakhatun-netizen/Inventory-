import { Router, Request, Response } from 'express';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '../src/firebase/config';
import {
  normalizePhoneNumber,
  generatePoMessageText,
  sendMetaCloudApiMessage,
  verifyMetaCredentials,
  recordWhatsAppAuditLog,
  getRestaurantWhatsAppConfig,
  saveRestaurantWhatsAppConfig,
  checkWhatsAppHealth,
  setTenantSecureToken,
  getTenantSecureToken,
  removeTenantSecureToken,
  resolveRestaurantForMetaEvent,
  verifyMetaWebhookSignature,
} from './whatsappService';
import { PurchaseOrder, Vendor, Restaurant } from '../src/types';
import { WhatsAppMessageRecord } from './types';

export const whatsappRouter = Router();

// Canonical environment variable: WHATSAPP_VERIFY_TOKEN
// If WHATSAPP_WEBHOOK_VERIFY_TOKEN exists, make it an alias of WHATSAPP_VERIFY_TOKEN to prevent inconsistency
if (!process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
  process.env.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
}
if (process.env.WHATSAPP_VERIFY_TOKEN && !process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
}

/**
 * GET /api/whatsapp/status
 * Check restaurant WhatsApp connection and health
 */
whatsappRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const restaurantId = req.query.restaurantId as string | undefined;

    const hasAccessToken = Boolean(process.env.WHATSAPP_ACCESS_TOKEN);
    const hasAppSecret = Boolean(process.env.WHATSAPP_APP_SECRET);
    const hasVerifyToken = Boolean(process.env.WHATSAPP_VERIFY_TOKEN);

    // If no restaurantId is provided, return overall server-side WhatsApp Cloud API configuration health
    if (!restaurantId) {
      const isServerReady = hasAccessToken && hasAppSecret && hasVerifyToken;
      const missingConfigs: string[] = [];
      if (!hasAccessToken) missingConfigs.push('WHATSAPP_ACCESS_TOKEN');
      if (!hasAppSecret) missingConfigs.push('WHATSAPP_APP_SECRET');
      if (!hasVerifyToken) missingConfigs.push('WHATSAPP_VERIFY_TOKEN');

      return res.json({
        service: 'WhatsApp Business Platform Cloud API',
        serverConfigured: isServerReady,
        hasAccessToken,
        hasAppSecret,
        hasVerifyToken,
        webhookPath: '/api/whatsapp/webhook',
        missingConfig: missingConfigs.length > 0 ? missingConfigs : null,
        message: isServerReady
          ? 'WhatsApp Business Cloud API server configuration is healthy and active'
          : `Server environment is missing required variables: ${missingConfigs.join(', ')}. Please set them in AI Studio environment variables or .env.`,
      });
    }

    const config = await getRestaurantWhatsAppConfig(restaurantId);
    if (!config || !config.connected) {
      return res.json({
        connected: false,
        status: 'DISCONNECTED',
        healthStatus: 'DISCONNECTED',
        restaurantId,
        businessPhoneNumber: config?.businessPhoneNumber || '',
        phoneNumberId: config?.phoneNumberId || '',
        businessAccountId: config?.businessAccountId || '',
        error: 'WhatsApp Business is not connected for this restaurant. Please connect in Settings.',
      });
    }

    const health = await checkWhatsAppHealth(restaurantId);

    return res.json({
      connected: health.connected,
      status: health.status,
      healthStatus: health.healthStatus,
      restaurantId,
      businessPhoneNumber: health.businessPhoneNumber || config.businessPhoneNumber || '',
      phoneNumberId: config.phoneNumberId || '',
      businessAccountId: config.businessAccountId || '',
      connectedByName: config.connectedByName || 'Owner',
      connectedAt: config.connectedAt || '',
      lastHealthCheckAt: health.lastHealthCheckAt || config.lastHealthCheckAt || '',
      lastWebhookAt: config.lastWebhookAt || '',
      lastSuccessfulMessageAt: config.lastSuccessfulMessageAt || '',
      error: health.error || config.lastError || null,
    });
  } catch (err) {
    console.error('WhatsApp status check error:', err);
    return res.status(500).json({
      error: 'Failed to retrieve WhatsApp status',
      details: err instanceof Error ? err.message : 'Unknown server error',
    });
  }
});

/**
 * POST /api/whatsapp/connect
 * OWNER-ONLY: Connects official WhatsApp Business number
 */
whatsappRouter.post('/connect', async (req: Request, res: Response) => {
  try {
    const {
      restaurantId,
      businessPhoneNumber,
      phoneNumberId,
      businessAccountId,
      accessToken,
      userUid,
      userName,
      userRole,
    } = req.body;

    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurantId is required' });
    }

    // STRICT OWNER CHECK
    const restDocRef = doc(db, 'restaurants', restaurantId);
    const restSnap = await getDoc(restDocRef);
    const restaurant = restSnap.data() as Restaurant | undefined;

    const isOwner = userRole === 'OWNER' || (restaurant && restaurant.ownerUid === userUid);
    if (!isOwner) {
      return res.status(403).json({
        error: 'Forbidden: Only the restaurant Owner is authorized to connect or manage WhatsApp Business.',
      });
    }

    if (!businessPhoneNumber?.trim()) {
      return res.status(400).json({ error: 'businessPhoneNumber is required' });
    }
    if (!phoneNumberId?.trim()) {
      return res.status(400).json({ error: 'phoneNumberId is required' });
    }
    if (!businessAccountId?.trim()) {
      return res.status(400).json({ error: 'businessAccountId is required' });
    }

    // Resolve token: provided or env
    const tokenToUse = accessToken?.trim() || process.env.WHATSAPP_ACCESS_TOKEN || '';
    if (!tokenToUse) {
      return res.status(400).json({
        error:
          'No WhatsApp Access Token available. Provide an access token or configure WHATSAPP_ACCESS_TOKEN on the server.',
      });
    }

    // Test credentials with Meta Graph API
    const metaTest = await verifyMetaCredentials(phoneNumberId.trim(), tokenToUse);
    if (!metaTest.ok) {
      return res.status(400).json({
        error: `Meta WhatsApp Cloud API verification failed: ${metaTest.error}`,
      });
    }

    // Save custom token into server vault if provided
    if (accessToken?.trim()) {
      setTenantSecureToken(restaurantId, accessToken.trim());
    }

    const now = new Date().toISOString();
    const configData = {
      connected: true,
      status: 'CONNECTED' as const,
      healthStatus: 'HEALTHY' as const,
      businessPhoneNumber: businessPhoneNumber.trim(),
      phoneNumberId: phoneNumberId.trim(),
      businessAccountId: businessAccountId.trim(),
      connectedByUid: userUid || 'unknown_owner',
      connectedByName: userName || 'Owner',
      connectedAt: now,
      lastHealthCheckAt: now,
      lastError: '',
      hasCustomAccessToken: Boolean(accessToken?.trim()),
    };

    await saveRestaurantWhatsAppConfig(restaurantId, configData);

    await recordWhatsAppAuditLog({
      restaurantId,
      actorUid: userUid || 'system',
      actorName: userName || 'Owner',
      action: 'WHATSAPP_CONNECTED',
      details: `Connected official WhatsApp number ${businessPhoneNumber.trim()} (Phone ID: ${phoneNumberId.trim()})`,
    });

    return res.json({
      success: true,
      message: 'WhatsApp Business connected and verified successfully',
      data: configData,
    });
  } catch (err) {
    console.error('WhatsApp connect error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to connect WhatsApp Business',
    });
  }
});

/**
 * POST /api/whatsapp/disconnect
 * OWNER-ONLY: Disconnects WhatsApp Business number
 */
whatsappRouter.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const { restaurantId, userUid, userName, userRole } = req.body;

    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurantId is required' });
    }

    // STRICT OWNER CHECK
    const restDocRef = doc(db, 'restaurants', restaurantId);
    const restSnap = await getDoc(restDocRef);
    const restaurant = restSnap.data() as Restaurant | undefined;

    const isOwner = userRole === 'OWNER' || (restaurant && restaurant.ownerUid === userUid);
    if (!isOwner) {
      return res.status(403).json({
        error: 'Forbidden: Only the restaurant Owner is authorized to disconnect WhatsApp Business.',
      });
    }

    removeTenantSecureToken(restaurantId);

    const now = new Date().toISOString();
    await saveRestaurantWhatsAppConfig(restaurantId, {
      connected: false,
      status: 'DISCONNECTED',
      healthStatus: 'DISCONNECTED',
      lastHealthCheckAt: now,
    });

    await recordWhatsAppAuditLog({
      restaurantId,
      actorUid: userUid || 'system',
      actorName: userName || 'Owner',
      action: 'WHATSAPP_DISCONNECTED',
      details: 'Disconnected official WhatsApp Business integration',
    });

    return res.json({
      success: true,
      message: 'WhatsApp Business disconnected successfully',
    });
  } catch (err) {
    console.error('WhatsApp disconnect error:', err);
    return res.status(500).json({ error: 'Failed to disconnect WhatsApp Business' });
  }
});

/**
 * POST /api/whatsapp/send-po
 * Staff and Manager endpoint to send a Purchase Order via WhatsApp Cloud API
 */
whatsappRouter.post('/send-po', async (req: Request, res: Response) => {
  try {
    const { restaurantId, purchaseOrderId, userUid, userName, userRole } = req.body;

    if (!restaurantId || !purchaseOrderId) {
      return res.status(400).json({ error: 'restaurantId and purchaseOrderId are required' });
    }

    // Check WhatsApp connection
    const config = await getRestaurantWhatsAppConfig(restaurantId);
    if (!config || !config.connected) {
      return res.status(400).json({
        code: 'WHATSAPP_NOT_CONNECTED',
        error:
          'WhatsApp Business is not connected for this restaurant. Please ask the Owner to connect WhatsApp Business before sending purchase orders.',
      });
    }

    const token = getTenantSecureToken(restaurantId);
    if (!token) {
      return res.status(400).json({
        code: 'WHATSAPP_AUTH_MISSING',
        error:
          'WhatsApp access token is missing on the server. Please ask the Owner to re-connect WhatsApp Business.',
      });
    }

    // Fetch PO
    const poRef = doc(db, 'restaurants', restaurantId, 'purchaseOrders', purchaseOrderId);
    const poSnap = await getDoc(poRef);
    if (!poSnap.exists()) {
      return res.status(404).json({ error: 'Purchase Order not found' });
    }
    const po = poSnap.data() as PurchaseOrder;

    // Fetch Vendor to get / verify phone
    let rawPhone = po.vendorPhone || '';
    if (!rawPhone && po.vendorId) {
      const vendorRef = doc(db, 'restaurants', restaurantId, 'vendors', po.vendorId);
      const vendorSnap = await getDoc(vendorRef);
      if (vendorSnap.exists()) {
        const vendor = vendorSnap.data() as Vendor;
        rawPhone = vendor.phone || vendor.mobile || '';
      }
    }

    if (!rawPhone || !rawPhone.trim()) {
      return res.status(400).json({
        code: 'VENDOR_PHONE_MISSING',
        error: 'Vendor WhatsApp/mobile number is missing. Please update the vendor contact details.',
      });
    }

    let normalizedPhone: string;
    try {
      normalizedPhone = normalizePhoneNumber(rawPhone);
    } catch (normErr) {
      return res.status(400).json({
        code: 'INVALID_PHONE',
        error: normErr instanceof Error ? normErr.message : 'Invalid vendor WhatsApp number.',
      });
    }

    // Fetch restaurant name & currency
    const restDocRef = doc(db, 'restaurants', restaurantId);
    const restSnap = await getDoc(restDocRef);
    const restaurant = restSnap.data() as Restaurant | undefined;
    const restaurantName = restaurant?.name || 'Restaurant Store Control';
    const currencySymbol = restaurant?.currencySymbol || restaurant?.currency || '₹';

    // Generate PO message
    const messageBody = generatePoMessageText(po, restaurantName, po.vendorName, currencySymbol);

    // Record pre-send audit
    await recordWhatsAppAuditLog({
      restaurantId,
      actorUid: userUid || 'system',
      actorName: userName || 'Staff',
      action: 'PO_WHATSAPP_SEND_REQUESTED',
      entityId: po.id,
      details: `Initiated official WhatsApp Cloud API dispatch for PO #${po.poNumber} to ${normalizedPhone}`,
    });

    // Send via Meta Cloud API
    let metaResult;
    try {
      metaResult = await sendMetaCloudApiMessage({
        phoneNumberId: config.phoneNumberId,
        accessToken: token,
        to: normalizedPhone,
        body: messageBody,
      });
    } catch (apiErr) {
      const errMsg = apiErr instanceof Error ? apiErr.message : String(apiErr);

      // Record failed attempt in whatsappMessages
      const failedMsgId = `failed_${Date.now()}`;
      const failedRecord: WhatsAppMessageRecord = {
        id: failedMsgId,
        restaurantId,
        purchaseOrderId: po.id,
        poNumber: po.poNumber,
        vendorId: po.vendorId,
        vendorName: po.vendorName,
        vendorPhone: normalizedPhone,
        messageId: failedMsgId,
        status: 'FAILED',
        messageBody,
        createdAt: new Date().toISOString(),
        failedAt: new Date().toISOString(),
        errorMessage: errMsg,
        sentByUid: userUid,
        sentByName: userName,
      };

      const msgDocRef = doc(db, 'restaurants', restaurantId, 'whatsappMessages', failedMsgId);
      await setDoc(msgDocRef, failedRecord);

      await recordWhatsAppAuditLog({
        restaurantId,
        actorUid: userUid || 'system',
        actorName: userName || 'Staff',
        action: 'PO_WHATSAPP_FAILED',
        entityId: po.id,
        details: `Failed to dispatch PO #${po.poNumber} via WhatsApp: ${errMsg}`,
      });

      return res.status(502).json({
        code: 'SEND_FAILED',
        error: `Failed to send via WhatsApp Business: ${errMsg}`,
      });
    }

    const messageId = metaResult.messageId;
    const now = new Date().toISOString();

    // Store successful dispatch in whatsappMessages
    const messageRecord: WhatsAppMessageRecord = {
      id: messageId,
      restaurantId,
      purchaseOrderId: po.id,
      poNumber: po.poNumber,
      vendorId: po.vendorId,
      vendorName: po.vendorName,
      vendorPhone: normalizedPhone,
      messageId,
      status: 'SENT',
      messageBody,
      createdAt: now,
      sentAt: now,
      sentByUid: userUid,
      sentByName: userName,
    };

    const msgDocRef = doc(db, 'restaurants', restaurantId, 'whatsappMessages', messageId);
    await setDoc(msgDocRef, messageRecord);

    // Update PO in Firestore
    await updateDoc(poRef, {
      status: 'SENT',
      sentAt: now,
      sentByUid: userUid || 'system',
      sentByName: userName || 'Staff',
      whatsappMessageId: messageId,
      vendorPhone: normalizedPhone,
      updatedAt: now,
    });

    // Update last successful message timestamp in settings
    await saveRestaurantWhatsAppConfig(restaurantId, {
      lastSuccessfulMessageAt: now,
    });

    await recordWhatsAppAuditLog({
      restaurantId,
      actorUid: userUid || 'system',
      actorName: userName || 'Staff',
      action: 'PO_WHATSAPP_SENT',
      entityId: po.id,
      details: `Successfully dispatched PO #${po.poNumber} via WhatsApp Cloud API (Message ID: ${messageId}) to ${normalizedPhone}`,
    });

    return res.json({
      success: true,
      messageId,
      status: 'SENT',
      recipientPhone: normalizedPhone,
    });
  } catch (err) {
    console.error('Send PO error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal error while sending Purchase Order via WhatsApp',
    });
  }
});

/**
 * POST /api/whatsapp/test-message
 * OWNER-ONLY: Send a live test message to verify the WhatsApp Business connection
 */
whatsappRouter.post('/test-message', async (req: Request, res: Response) => {
  try {
    const { restaurantId, recipientPhone, userUid, userName, userRole } = req.body;

    if (!restaurantId || !recipientPhone?.trim()) {
      return res.status(400).json({ error: 'restaurantId and recipientPhone are required' });
    }

    const restDocRef = doc(db, 'restaurants', restaurantId);
    const restSnap = await getDoc(restDocRef);
    const restaurant = restSnap.data() as Restaurant | undefined;

    const isOwner = userRole === 'OWNER' || (restaurant && restaurant.ownerUid === userUid);
    if (!isOwner) {
      return res.status(403).json({
        error: 'Forbidden: Only the restaurant Owner is authorized to send test WhatsApp messages.',
      });
    }

    const config = await getRestaurantWhatsAppConfig(restaurantId);
    if (!config || !config.connected) {
      return res.status(400).json({
        code: 'WHATSAPP_NOT_CONNECTED',
        error: 'WhatsApp Business is not connected for this restaurant.',
      });
    }

    const token = getTenantSecureToken(restaurantId);
    if (!token) {
      return res.status(400).json({
        code: 'WHATSAPP_AUTH_MISSING',
        error: 'WhatsApp access token is missing on the server.',
      });
    }

    let normalizedPhone: string;
    try {
      normalizedPhone = normalizePhoneNumber(recipientPhone.trim());
    } catch (normErr) {
      return res.status(400).json({
        code: 'INVALID_PHONE',
        error: normErr instanceof Error ? normErr.message : 'Invalid test phone number.',
      });
    }

    const restaurantName = restaurant?.name || 'Restaurant Store Control';
    const testBody = `✅ WhatsApp Business Connection Test\n\nRestaurant: ${restaurantName}\nStatus: Verified & Operational\nDispatched: ${new Date().toLocaleString('en-IN')}\n\nYour restaurant's official WhatsApp Business Platform integration is active and ready to transmit Purchase Orders.`;

    const metaResult = await sendMetaCloudApiMessage({
      phoneNumberId: config.phoneNumberId,
      accessToken: token,
      to: normalizedPhone,
      body: testBody,
    });

    const now = new Date().toISOString();
    const messageId = metaResult.messageId;

    // Save test record
    const messageRecord: WhatsAppMessageRecord = {
      id: messageId,
      restaurantId,
      vendorPhone: normalizedPhone,
      messageId,
      status: 'SENT',
      messageBody: testBody,
      createdAt: now,
      sentAt: now,
      isTestMessage: true,
      sentByUid: userUid,
      sentByName: userName,
    };

    const msgDocRef = doc(db, 'restaurants', restaurantId, 'whatsappMessages', messageId);
    await setDoc(msgDocRef, messageRecord);

    await saveRestaurantWhatsAppConfig(restaurantId, {
      lastSuccessfulMessageAt: now,
    });

    await recordWhatsAppAuditLog({
      restaurantId,
      actorUid: userUid || 'system',
      actorName: userName || 'Owner',
      action: 'WHATSAPP_TEST_MESSAGE_SENT',
      details: `Sent test message via WhatsApp Cloud API to ${normalizedPhone} (ID: ${messageId})`,
    });

    return res.json({
      success: true,
      messageId,
      recipientPhone: normalizedPhone,
    });
  } catch (err) {
    console.error('Test message error:', err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to send test message via WhatsApp Cloud API',
    });
  }
});

/**
 * GET /api/whatsapp/history
 * Retrieve WhatsApp message history for a PO or restaurant
 */
whatsappRouter.get('/history', async (req: Request, res: Response) => {
  try {
    const restaurantId = req.query.restaurantId as string;
    const purchaseOrderId = req.query.purchaseOrderId as string | undefined;

    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurantId is required' });
    }

    const messagesCol = collection(db, 'restaurants', restaurantId, 'whatsappMessages');
    let q = query(messagesCol, orderBy('createdAt', 'desc'), limit(50));

    if (purchaseOrderId) {
      q = query(
        messagesCol,
        where('purchaseOrderId', '==', purchaseOrderId),
        orderBy('createdAt', 'desc'),
        limit(20)
      );
    }

    const snap = await getDocs(q);
    const messages = snap.docs.map((d) => d.data() as WhatsAppMessageRecord);

    return res.json({ messages });
  } catch (err) {
    console.error('History error:', err);
    return res.status(500).json({ error: 'Failed to retrieve message history' });
  }
});

/**
 * GET /api/whatsapp/webhook
 * Meta Webhook verification handshake
 * Query parameters: hub.mode, hub.verify_token, hub.challenge
 */
whatsappRouter.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Canonical environment variable: WHATSAPP_VERIFY_TOKEN
  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (!expectedToken) {
    console.warn('[WhatsApp Webhook] Verification failed: WHATSAPP_VERIFY_TOKEN is not configured in server environment');
    return res.status(403).type('text/plain').send('Forbidden');
  }

  if (mode === 'subscribe' && token === expectedToken) {
    console.log('[WhatsApp Webhook] Verification handshake successful');
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(String(challenge ?? ''));
  }

  console.warn('[WhatsApp Webhook] Verification handshake failed: mode or token mismatch');
  return res.status(403).type('text/plain').send('Forbidden');
});

/**
 * POST /api/whatsapp/webhook
 * Meta Webhook status notifications (sent, delivered, read, failed)
 */
whatsappRouter.post('/webhook', async (req: Request, res: Response) => {
  try {
    const appSecret = process.env.WHATSAPP_APP_SECRET;
    if (!appSecret) {
      console.warn('[WhatsApp Webhook] WHATSAPP_APP_SECRET is not configured on server');
      return res.status(500).json({
        error: 'WHATSAPP_APP_SECRET is not configured on server. Unable to verify webhook signature.',
      });
    }

    const signatureHeader = (req.headers['x-hub-signature-256'] ||
      req.headers['X-Hub-Signature-256']) as string | undefined;

    const rawBody =
      (req as any).rawBody ||
      Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body), 'utf8');

    const sigResult = verifyMetaWebhookSignature(rawBody, signatureHeader, appSecret);
    if (!sigResult.valid) {
      console.warn(`[WhatsApp Webhook] Signature verification rejected: ${sigResult.reason}`);
      return res.status(401).json({
        error: 'Unauthorized: Invalid or missing X-Hub-Signature-256 webhook signature',
        reason: sigResult.reason,
      });
    }

    const body = req.body;

    if (body?.object === 'whatsapp_business_account' && Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        const businessAccountId = entry.id; // WABA account ID
        if (!Array.isArray(entry.changes)) continue;

        for (const change of entry.changes) {
          const value = change.value;
          if (!value || !Array.isArray(value.statuses)) continue;

          const phoneNumberId = value.metadata?.phone_number_id;

          for (const statusObj of value.statuses) {
            const messageId = statusObj.id;
            const rawStatus = (statusObj.status || '').toLowerCase(); // 'sent' | 'delivered' | 'read' | 'failed'

            if (!messageId || !['sent', 'delivered', 'read', 'failed'].includes(rawStatus)) {
              continue;
            }

            const timestamp = statusObj.timestamp
              ? new Date(Number(statusObj.timestamp) * 1000).toISOString()
              : new Date().toISOString();

            // Multi-tenant safe restaurant resolution
            const restaurantId = await resolveRestaurantForMetaEvent({
              phoneNumberId,
              businessAccountId,
              messageId,
            });

            if (!restaurantId) {
              console.warn(
                `[WhatsApp Webhook] Ignored unmapped event for message ${messageId}. Phone ID: ${phoneNumberId || 'N/A'}, Account: ${businessAccountId || 'N/A'}`
              );
              continue;
            }

            const msgRef = doc(db, 'restaurants', restaurantId, 'whatsappMessages', messageId);
            const msgSnap = await getDoc(msgRef);

            const errorCode = statusObj.errors?.[0]?.code
              ? String(statusObj.errors[0].code)
              : undefined;
            const errorMessage =
              statusObj.errors?.[0]?.title || statusObj.errors?.[0]?.message || undefined;

            if (msgSnap.exists()) {
              const currentData = msgSnap.data() as WhatsAppMessageRecord;
              const updatePayload: Partial<WhatsAppMessageRecord> = {};

              if (rawStatus === 'sent') {
                updatePayload.status = 'SENT';
                updatePayload.sentAt = currentData.sentAt || timestamp;
              } else if (rawStatus === 'delivered') {
                updatePayload.status = 'DELIVERED';
                updatePayload.deliveredAt = timestamp;
              } else if (rawStatus === 'read') {
                updatePayload.status = 'READ';
                updatePayload.readAt = timestamp;
                if (!currentData.deliveredAt) {
                  updatePayload.deliveredAt = timestamp;
                }
              } else if (rawStatus === 'failed') {
                updatePayload.status = 'FAILED';
                updatePayload.failedAt = timestamp;
                updatePayload.errorCode = errorCode || currentData.errorCode || 'UNKNOWN';
                updatePayload.errorMessage =
                  errorMessage || currentData.errorMessage || 'Message delivery failed';
              }

              await updateDoc(msgRef, updatePayload);

              // Update associated purchase order if linked
              if (currentData.purchaseOrderId) {
                const poRef = doc(
                  db,
                  'restaurants',
                  restaurantId,
                  'purchaseOrders',
                  currentData.purchaseOrderId
                );
                const poSnap = await getDoc(poRef);
                if (poSnap.exists()) {
                  const poUpdate: any = {
                    whatsappStatus: rawStatus.toUpperCase(),
                    updatedAt: timestamp,
                  };
                  if (rawStatus === 'delivered') poUpdate.whatsappDeliveredAt = timestamp;
                  if (rawStatus === 'read') poUpdate.whatsappReadAt = timestamp;
                  if (rawStatus === 'failed' && errorMessage) poUpdate.whatsappError = errorMessage;

                  await updateDoc(poRef, poUpdate);
                }
              }

              // Update restaurant settings lastWebhookAt
              await saveRestaurantWhatsAppConfig(restaurantId, {
                lastWebhookAt: timestamp,
              });

              await recordWhatsAppAuditLog({
                restaurantId,
                actorUid: 'whatsapp_webhook',
                actorName: 'WhatsApp Cloud API',
                action: `PO_WHATSAPP_${rawStatus.toUpperCase()}`,
                entityId: currentData.purchaseOrderId || messageId,
                details: `WhatsApp message ${messageId} delivery status transitioned to ${rawStatus.toUpperCase()}`,
              });
            } else {
              // Create record if it does not exist yet with all required safe fields
              const newRecord: WhatsAppMessageRecord = {
                id: messageId,
                restaurantId,
                messageId,
                vendorPhone: statusObj.recipient_id || '',
                status: rawStatus.toUpperCase() as any,
                createdAt: timestamp,
                ...(rawStatus === 'sent' ? { sentAt: timestamp } : {}),
                ...(rawStatus === 'delivered' ? { deliveredAt: timestamp } : {}),
                ...(rawStatus === 'read' ? { readAt: timestamp, deliveredAt: timestamp } : {}),
                ...(rawStatus === 'failed' ? { failedAt: timestamp, errorCode, errorMessage } : {}),
              };

              await setDoc(msgRef, newRecord);

              await saveRestaurantWhatsAppConfig(restaurantId, {
                lastWebhookAt: timestamp,
              });

              await recordWhatsAppAuditLog({
                restaurantId,
                actorUid: 'whatsapp_webhook',
                actorName: 'WhatsApp Cloud API',
                action: `PO_WHATSAPP_${rawStatus.toUpperCase()}`,
                entityId: messageId,
                details: `Recorded incoming WhatsApp status ${rawStatus.toUpperCase()} for message ${messageId}`,
              });
            }
          }
        }
      }
    }

    return res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook processing error:', err);
    return res.status(500).json({ error: 'Webhook processing error' });
  }
});
