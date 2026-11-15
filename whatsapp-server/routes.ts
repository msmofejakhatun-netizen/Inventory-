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
  extractBearerToken,
  verifyRestaurantOwnerAccess,
  getMetaAppCredentials,
  getMetaEmbeddedSignupConfig,
  exchangeEmbeddedSignupCode,
  inspectMetaAccessToken,
  verifyMetaWaba,
  subscribeAppToWaba,
  fetchWabaPhoneNumbers,
  registerCloudApiPhoneNumber,
  syncCoexistenceAppData,
  firestoreRestGetDoc,
  firestoreRestPatchDoc,
} from './whatsappService';
import { PurchaseOrder, Vendor, Restaurant } from '../src/types';
import {
  WhatsAppConfig,
  WhatsAppMessageRecord,
  WhatsAppVerificationChecks,
  WhatsAppWebhookStatus,
} from './types';
import { generateServerPoImageBuffer } from './excelPoImageServer';

export const whatsappRouter = Router();

// Canonical environment variable: WHATSAPP_VERIFY_TOKEN
if (!process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
  process.env.WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
}
if (process.env.WHATSAPP_VERIFY_TOKEN && !process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
}

/**
 * GET /api/whatsapp/embedded-signup/config
 * Returns public Meta Embedded Signup configuration and exact missing prerequisites (never secrets).
 */
whatsappRouter.get('/embedded-signup/config', (req: Request, res: Response) => {
  try {
    const forwardedProto = req.headers['x-forwarded-proto'] as string | undefined;
    const host = req.headers.host;
    const inferredOrigin =
      process.env.APP_URL ||
      (host ? `${forwardedProto || req.protocol || 'https'}://${host}` : '');

    const signupConfig = getMetaEmbeddedSignupConfig(inferredOrigin);
    return res.json(signupConfig);
  } catch (err) {
    console.error('Embedded Signup config error:', err);
    return res.status(500).json({
      ready: false,
      error: 'Failed to inspect Meta Embedded Signup configuration',
    });
  }
});

/**
 * POST /api/whatsapp/embedded-signup/complete
 * OWNER-ONLY: Exchanges official Meta Embedded Signup OAuth code on the backend,
 * verifies WABA, Cloud API permissions, registered phone number, and webhook subscription,
 * stores the token strictly server-side, and returns real verified state.
 */
whatsappRouter.post('/embedded-signup/complete', async (req: Request, res: Response) => {
  try {
    const idToken = extractBearerToken(req.headers.authorization);
    const {
      restaurantId,
      code,
      wabaId: rawWabaId,
      phoneNumberId: rawPhoneNumberId,
      businessId: rawBusinessId,
      eventType,
      coexistenceRequested,
      userUid,
      userName,
      userRole,
    } = req.body || {};

    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurantId is required' });
    }

    const ownerCheck = await verifyRestaurantOwnerAccess({
      restaurantId,
      idToken,
      fallbackUid: userUid,
      fallbackRole: userRole,
    });

    if (!ownerCheck.authorized) {
      return res.status(403).json({
        error: ownerCheck.reason || 'Forbidden: Only the restaurant Owner can connect WhatsApp Business.',
      });
    }

    const { appId, appSecret, verifyToken } = getMetaAppCredentials();
    const missingServerVars: string[] = [];
    if (!appId) missingServerVars.push('META_APP_ID (and VITE_META_APP_ID)');
    if (!appSecret) missingServerVars.push('META_APP_SECRET');

    if (missingServerVars.length > 0) {
      return res.status(400).json({
        status: 'ACTION_REQUIRED',
        code: 'META_CONFIGURATION_MISSING',
        missingRequirements: missingServerVars,
        error: `Meta Embedded Signup V4 cannot complete on the server because required configuration is missing: ${missingServerVars.join(', ')}.`,
      });
    }

    if (!code || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({
        status: 'ACTION_REQUIRED',
        code: 'OAUTH_CODE_MISSING',
        error: 'Meta Embedded Signup authorization code was not received. Please complete the Meta login dialog and try again.',
      });
    }

    // 1. Exchange authorization code for Meta Business/User access token (server-side only)
    const tokenExchange = await exchangeEmbeddedSignupCode({
      appId,
      appSecret,
      code: code.trim(),
    });

    const now = new Date().toISOString();

    if (!tokenExchange.ok || !tokenExchange.accessToken) {
      await saveRestaurantWhatsAppConfig(
        restaurantId,
        {
          connected: false,
          status: 'CONNECTION_ERROR',
          healthStatus: 'UNHEALTHY',
          apiStatus: 'UNHEALTHY',
          webhookStatus: 'ERROR',
          lastError: tokenExchange.error || 'Meta OAuth code exchange failed',
          lastHealthCheckAt: now,
        },
        idToken
      );

      return res.status(400).json({
        connected: false,
        status: 'CONNECTION_ERROR',
        error: `Meta OAuth code exchange failed: ${tokenExchange.error}`,
      });
    }

    const accessToken = tokenExchange.accessToken;

    // 2. Inspect token validity, permissions, and granular WABA target IDs
    const tokenInfo = await inspectMetaAccessToken({
      accessToken,
      appId,
      appSecret,
    });

    if (!tokenInfo.ok || !tokenInfo.isValid) {
      await saveRestaurantWhatsAppConfig(
        restaurantId,
        {
          connected: false,
          status: 'CONNECTION_ERROR',
          healthStatus: 'UNHEALTHY',
          apiStatus: 'UNHEALTHY',
          webhookStatus: 'ERROR',
          lastError: tokenInfo.error || 'Meta access token verification failed',
          lastHealthCheckAt: now,
        },
        idToken
      );

      return res.status(400).json({
        connected: false,
        status: 'CONNECTION_ERROR',
        error: `Meta access token validation failed: ${tokenInfo.error}`,
      });
    }

    const grantedPermissions = tokenInfo.grantedPermissions;
    const hasMessagingPerm =
      grantedPermissions.length === 0 ||
      grantedPermissions.includes('whatsapp_business_messaging');
    const hasManagementPerm =
      grantedPermissions.length === 0 ||
      grantedPermissions.includes('whatsapp_business_management');
    const permissionsVerified = hasMessagingPerm && hasManagementPerm;

    const wabaId = (rawWabaId || tokenInfo.resolvedWabaId || '').trim();
    if (!wabaId) {
      const reason =
        'No WhatsApp Business Account (WABA) was selected or created during Meta Embedded Signup.';
      await saveRestaurantWhatsAppConfig(
        restaurantId,
        {
          connected: false,
          status: 'ACTION_REQUIRED',
          healthStatus: 'DEGRADED',
          apiStatus: 'DEGRADED',
          webhookStatus: 'ACTION_REQUIRED',
          actionRequiredReason: reason,
          lastError: reason,
          lastHealthCheckAt: now,
        },
        idToken
      );

      return res.status(400).json({
        connected: false,
        status: 'ACTION_REQUIRED',
        error: reason,
      });
    }

    // 3. Verify WABA account with Meta Graph API
    const wabaCheck = await verifyMetaWaba({ wabaId, accessToken });
    if (!wabaCheck.ok) {
      const errMsg = wabaCheck.error || 'Failed to verify WhatsApp Business Account with Meta';
      await saveRestaurantWhatsAppConfig(
        restaurantId,
        {
          connected: false,
          status: 'CONNECTION_ERROR',
          healthStatus: 'UNHEALTHY',
          apiStatus: 'UNHEALTHY',
          webhookStatus: 'ERROR',
          businessAccountId: wabaId,
          lastError: errMsg,
          lastHealthCheckAt: now,
        },
        idToken
      );

      return res.status(400).json({
        connected: false,
        status: 'CONNECTION_ERROR',
        error: errMsg,
      });
    }

    // 4. Subscribe STOQO app webhook to the customer's WABA
    const subscriptionResult = await subscribeAppToWaba({ wabaId, accessToken });
    const webhookEndpointVerified = Boolean(appSecret && verifyToken);
    const webhookSubscribed = subscriptionResult.ok && subscriptionResult.subscribed;
    const webhookStatus: WhatsAppWebhookStatus =
      webhookSubscribed && webhookEndpointVerified ? 'ACTIVE' : 'ACTION_REQUIRED';

    // 5. Resolve & verify registered Phone Number
    let phoneNumberId = (rawPhoneNumberId || '').trim();
    if (!phoneNumberId) {
      const numbersRes = await fetchWabaPhoneNumbers({ wabaId, accessToken });
      if (numbersRes.ok && numbersRes.numbers.length > 0) {
        const verifiedNum =
          numbersRes.numbers.find((n) => n.code_verification_status === 'VERIFIED') ||
          numbersRes.numbers[0];
        phoneNumberId = verifiedNum.id;
      }
    }

    // Store token securely server-side ONLY (isolated by restaurantId, never exposed to client)
    setTenantSecureToken(restaurantId, accessToken);

    const isCoexistence =
      eventType === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' ||
      Boolean(coexistenceRequested && eventType !== 'FINISH_ONLY_WABA');
    const onboardingType: WhatsAppConfig['onboardingType'] =
      eventType === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
        ? 'WHATSAPP_BUSINESS_APP_COEXISTENCE'
        : eventType === 'FINISH_ONLY_WABA'
          ? 'WABA_ONLY'
          : 'STANDARD_CLOUD_API';

    if (!phoneNumberId) {
      const checks: WhatsAppVerificationChecks = {
        wabaVerified: true,
        phoneVerified: false,
        permissionsVerified,
        webhookSubscribed,
        webhookEndpointVerified,
      };
      const reason =
        'WhatsApp Business Account was authorized, but phone number verification was not completed in Meta. Click Reconnect to register and verify your mobile number.';

      await saveRestaurantWhatsAppConfig(
        restaurantId,
        {
          connected: false,
          status: 'ACTION_REQUIRED',
          healthStatus: 'DEGRADED',
          apiStatus: 'DEGRADED',
          webhookStatus,
          businessPhoneNumber: '',
          verifiedName: '',
          phoneNumberId: '',
          businessAccountId: wabaId,
          businessId: rawBusinessId || '',
          wabaName: wabaCheck.wabaName || '',
          connectedByUid: ownerCheck.uid || userUid || 'owner',
          connectedByName: userName || 'Owner',
          connectedAt: now,
          coexistenceMode: isCoexistence,
          onboardingType,
          accountReviewStatus: wabaCheck.accountReviewStatus || '',
          grantedPermissions,
          verificationChecks: checks,
          actionRequiredReason: reason,
          lastError: reason,
          lastHealthCheckAt: now,
          hasCustomAccessToken: true,
        },
        idToken
      );

      await recordWhatsAppAuditLog({
        restaurantId,
        actorUid: ownerCheck.uid || userUid || 'system',
        actorName: userName || 'Owner',
        action: 'WHATSAPP_EMBEDDED_SIGNUP_ACTION_REQUIRED',
        entityId: wabaId,
        details: reason,
        idToken,
      });

      return res.json({
        success: false,
        connected: false,
        status: 'ACTION_REQUIRED',
        healthStatus: 'DEGRADED',
        apiStatus: 'DEGRADED',
        webhookStatus,
        businessAccountId: wabaId,
        wabaName: wabaCheck.wabaName || '',
        verificationChecks: checks,
        error: reason,
      });
    }

    const phoneCheck = await verifyMetaCredentials(phoneNumberId, accessToken);
    if (!phoneCheck.ok) {
      const checks: WhatsAppVerificationChecks = {
        wabaVerified: true,
        phoneVerified: false,
        permissionsVerified,
        webhookSubscribed,
        webhookEndpointVerified,
      };
      const errMsg = phoneCheck.error || 'Failed to verify WhatsApp Business phone number with Meta';

      await saveRestaurantWhatsAppConfig(
        restaurantId,
        {
          connected: false,
          status: 'CONNECTION_ERROR',
          healthStatus: 'UNHEALTHY',
          apiStatus: 'UNHEALTHY',
          webhookStatus,
          phoneNumberId,
          businessAccountId: wabaId,
          businessId: rawBusinessId || '',
          wabaName: wabaCheck.wabaName || '',
          verificationChecks: checks,
          lastError: errMsg,
          lastHealthCheckAt: now,
          hasCustomAccessToken: true,
        },
        idToken
      );

      return res.status(400).json({
        connected: false,
        status: 'CONNECTION_ERROR',
        error: errMsg,
      });
    }

    const phoneNotVerified =
      Boolean(phoneCheck.codeVerificationStatus) &&
      phoneCheck.codeVerificationStatus !== 'VERIFIED';

    // 6. Complete Cloud API Phone Number Registration (`POST /{phoneNumberId}/register`)
    // or initiate Coexistence app state/history sync (`POST /{phoneNumberId}/smb_app_data`)
    if (!phoneNotVerified) {
      if (isCoexistence) {
        await syncCoexistenceAppData({ phoneNumberId, accessToken });
      } else if (phoneCheck.phoneStatus !== 'CONNECTED') {
        const regResult = await registerCloudApiPhoneNumber({
          phoneNumberId,
          accessToken,
        });
        if (!regResult.ok) {
          console.warn(
            `[WhatsApp Embedded Signup] Phone registration notice for ${phoneNumberId}: ${regResult.error}`
          );
        }
      }
    }

    const checks: WhatsAppVerificationChecks = {
      wabaVerified: true,
      phoneVerified: !phoneNotVerified,
      permissionsVerified,
      webhookSubscribed,
      webhookEndpointVerified,
    };

    const actionReasons: string[] = [];
    if (phoneNotVerified) {
      actionReasons.push(
        `Phone number verification status is ${phoneCheck.codeVerificationStatus}. Complete OTP verification in Meta.`
      );
    }
    if (!permissionsVerified) {
      actionReasons.push(
        'Missing required Meta Cloud API permissions: whatsapp_business_management and whatsapp_business_messaging.'
      );
    }
    if (!webhookSubscribed) {
      actionReasons.push(
        subscriptionResult.error || 'WABA webhook subscription could not be verified.'
      );
    }
    if (!webhookEndpointVerified) {
      actionReasons.push(
        'Server webhook verification token (WHATSAPP_VERIFY_TOKEN) is not configured yet.'
      );
    }

    const fullyConnected =
      checks.wabaVerified &&
      checks.phoneVerified &&
      checks.permissionsVerified &&
      checks.webhookSubscribed &&
      checks.webhookEndpointVerified;

    const finalStatus = fullyConnected ? 'CONNECTED' : 'ACTION_REQUIRED';
    const finalHealth = fullyConnected ? 'HEALTHY' : 'DEGRADED';
    const finalApiStatus = checks.phoneVerified && checks.permissionsVerified ? 'HEALTHY' : 'DEGRADED';
    const actionReasonStr = actionReasons.join(' ');

    const configData: Partial<WhatsAppConfig> = {
      connected: fullyConnected,
      status: finalStatus,
      healthStatus: finalHealth,
      apiStatus: finalApiStatus,
      webhookStatus,
      businessPhoneNumber: phoneCheck.displayPhoneNumber || '',
      verifiedName: phoneCheck.verifiedName || wabaCheck.wabaName || '',
      phoneNumberId,
      businessAccountId: wabaId,
      businessId: rawBusinessId || '',
      wabaName: wabaCheck.wabaName || '',
      connectedByUid: ownerCheck.uid || userUid || 'owner',
      connectedByName: userName || 'Owner',
      connectedAt: now,
      lastHealthCheckAt: now,
      lastError: actionReasonStr,
      actionRequiredReason: actionReasonStr,
      coexistenceMode: isCoexistence,
      onboardingType,
      codeVerificationStatus: phoneCheck.codeVerificationStatus || 'VERIFIED',
      qualityRating: phoneCheck.qualityRating || '',
      accountReviewStatus: wabaCheck.accountReviewStatus || '',
      grantedPermissions,
      verificationChecks: checks,
      hasCustomAccessToken: true,
    };

    await saveRestaurantWhatsAppConfig(restaurantId, configData, idToken);

    await recordWhatsAppAuditLog({
      restaurantId,
      actorUid: ownerCheck.uid || userUid || 'system',
      actorName: userName || 'Owner',
      action: fullyConnected
        ? 'WHATSAPP_EMBEDDED_SIGNUP_CONNECTED'
        : 'WHATSAPP_EMBEDDED_SIGNUP_ACTION_REQUIRED',
      entityId: phoneNumberId,
      details: fullyConnected
        ? `Connected WhatsApp Business ${phoneCheck.displayPhoneNumber || phoneNumberId} via official Meta Embedded Signup (${onboardingType})`
        : `Embedded Signup partially completed (${finalStatus}): ${actionReasonStr}`,
      idToken,
    });

    return res.json({
      success: fullyConnected,
      connected: fullyConnected,
      status: finalStatus,
      healthStatus: finalHealth,
      apiStatus: finalApiStatus,
      webhookStatus,
      businessPhoneNumber: configData.businessPhoneNumber,
      verifiedName: configData.verifiedName,
      phoneNumberId,
      businessAccountId: wabaId,
      wabaName: configData.wabaName,
      coexistenceMode: isCoexistence,
      onboardingType,
      verificationChecks: checks,
      error: actionReasonStr || null,
      message: fullyConnected
        ? 'WhatsApp Business connected and verified via official Meta Embedded Signup'
        : actionReasonStr,
    });
  } catch (err) {
    console.error('Embedded Signup completion error:', err);
    return res.status(500).json({
      connected: false,
      status: 'CONNECTION_ERROR',
      error: err instanceof Error ? err.message : 'Failed to complete Meta WhatsApp Embedded Signup',
    });
  }
});

/**
 * GET /api/whatsapp/status
 * Check restaurant WhatsApp connection and health
 */
whatsappRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const restaurantId = req.query.restaurantId as string | undefined;
    const idToken = extractBearerToken(req.headers.authorization);

    const { appId, configId, appSecret, verifyToken } = getMetaAppCredentials();
    const hasAccessToken = Boolean(process.env.WHATSAPP_ACCESS_TOKEN);
    const hasAppSecret = Boolean(appSecret);
    const hasVerifyToken = Boolean(verifyToken);

    if (!restaurantId) {
      const isServerReady = Boolean(appId && configId && hasAppSecret && hasVerifyToken);
      const missingConfigs: string[] = [];
      if (!appId) missingConfigs.push('META_APP_ID');
      if (!configId) missingConfigs.push('META_EMBEDDED_SIGNUP_CONFIG_ID');
      if (!hasAppSecret) missingConfigs.push('WHATSAPP_APP_SECRET');
      if (!hasVerifyToken) missingConfigs.push('WHATSAPP_VERIFY_TOKEN');

      return res.json({
        service: 'WhatsApp Business Platform Cloud API (Embedded Signup)',
        serverConfigured: isServerReady,
        hasMetaAppId: Boolean(appId),
        hasEmbeddedSignupConfigId: Boolean(configId),
        hasAccessToken,
        hasAppSecret,
        hasVerifyToken,
        webhookPath: '/api/whatsapp/webhook',
        missingConfig: missingConfigs.length > 0 ? missingConfigs : null,
        message: isServerReady
          ? 'WhatsApp Business Embedded Signup & Cloud API server configuration is ready'
          : `Server environment is missing Meta Embedded Signup variables: ${missingConfigs.join(', ')}.`,
      });
    }

    const health = await checkWhatsAppHealth(restaurantId, idToken);
    const config = await getRestaurantWhatsAppConfig(restaurantId, idToken);

    return res.json({
      connected: health.connected,
      status: health.status,
      healthStatus: health.healthStatus,
      apiStatus: health.apiStatus,
      webhookStatus: health.webhookStatus,
      restaurantId,
      businessPhoneNumber: health.businessPhoneNumber || config?.businessPhoneNumber || '',
      verifiedName: health.verifiedName || config?.verifiedName || '',
      phoneNumberId: health.phoneNumberId || config?.phoneNumberId || '',
      businessAccountId: health.businessAccountId || config?.businessAccountId || '',
      wabaName: config?.wabaName || '',
      coexistenceMode: Boolean(health.coexistenceMode || config?.coexistenceMode),
      onboardingType: config?.onboardingType || 'STANDARD_CLOUD_API',
      verificationChecks: health.verificationChecks || config?.verificationChecks || null,
      connectedByName: config?.connectedByName || 'Owner',
      connectedAt: config?.connectedAt || '',
      lastHealthCheckAt: health.lastHealthCheckAt || config?.lastHealthCheckAt || '',
      lastWebhookAt: health.lastWebhookAt || config?.lastWebhookAt || '',
      lastSuccessfulMessageAt:
        health.lastSuccessfulMessageAt || config?.lastSuccessfulMessageAt || '',
      error: health.error || config?.lastError || null,
    });
  } catch (err) {
    console.error('WhatsApp status check error:', err);
    return res.status(500).json({
      status: 'CONNECTION_ERROR',
      error: 'Failed to retrieve WhatsApp status',
      details: err instanceof Error ? err.message : 'Unknown server error',
    });
  }
});

/**
 * POST /api/whatsapp/connect
 * Legacy manual credentials endpoint replaced by Official Meta Embedded Signup.
 */
whatsappRouter.post('/connect', (_req: Request, res: Response) => {
  return res.status(410).json({
    code: 'MANUAL_CONNECT_REPLACED',
    error:
      'Manual Phone Number ID / WABA ID / Access Token connection has been replaced by Official Meta WhatsApp Embedded Signup. Click "Connect WhatsApp Business" in Settings.',
  });
});

/**
 * POST /api/whatsapp/disconnect
 * OWNER-ONLY: Disconnects WhatsApp Business number
 */
whatsappRouter.post('/disconnect', async (req: Request, res: Response) => {
  try {
    const idToken = extractBearerToken(req.headers.authorization);
    const { restaurantId, userUid, userName, userRole } = req.body || {};

    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurantId is required' });
    }

    const ownerCheck = await verifyRestaurantOwnerAccess({
      restaurantId,
      idToken,
      fallbackUid: userUid,
      fallbackRole: userRole,
    });

    if (!ownerCheck.authorized) {
      return res.status(403).json({
        error:
          ownerCheck.reason ||
          'Forbidden: Only the restaurant Owner is authorized to disconnect WhatsApp Business.',
      });
    }

    removeTenantSecureToken(restaurantId);

    const now = new Date().toISOString();
    await saveRestaurantWhatsAppConfig(
      restaurantId,
      {
        connected: false,
        status: 'NOT_CONNECTED',
        healthStatus: 'DISCONNECTED',
        apiStatus: 'DISCONNECTED',
        webhookStatus: 'INACTIVE',
        lastError: '',
        actionRequiredReason: '',
        lastHealthCheckAt: now,
        hasCustomAccessToken: false,
      },
      idToken
    );

    await recordWhatsAppAuditLog({
      restaurantId,
      actorUid: ownerCheck.uid || userUid || 'system',
      actorName: userName || 'Owner',
      action: 'WHATSAPP_DISCONNECTED',
      details: 'Disconnected official WhatsApp Business integration',
      idToken,
    });

    return res.json({
      success: true,
      status: 'NOT_CONNECTED',
      message: 'WhatsApp Business disconnected successfully',
    });
  } catch (err) {
    console.error('WhatsApp disconnect error:', err);
    return res.status(500).json({ error: 'Failed to disconnect WhatsApp Business' });
  }
});

/**
 * GET /api/whatsapp/po-image/:restaurantId/:purchaseOrderId.png
 * Serves the dynamically generated high-resolution Excel-style Purchase Order image.
 */
whatsappRouter.get('/po-image/:restaurantId/:purchaseOrderId.png', async (req: Request, res: Response) => {
  try {
    const { restaurantId, purchaseOrderId } = req.params;
    if (!restaurantId || !purchaseOrderId) {
      return res.status(400).send('Missing restaurantId or purchaseOrderId');
    }

    const poRef = doc(db, 'restaurants', restaurantId, 'purchaseOrders', purchaseOrderId);
    const poSnap = await getDoc(poRef);
    if (!poSnap.exists()) {
      return res.status(404).send('Purchase Order not found');
    }
    const po = poSnap.data() as PurchaseOrder;

    const restDocRef = doc(db, 'restaurants', restaurantId);
    const restSnap = await getDoc(restDocRef);
    const restaurant = restSnap.data() as Restaurant | undefined;
    const restaurantName = restaurant?.name || 'STOQO';

    const { buffer, filename } = generateServerPoImageBuffer(po, restaurantName);

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.send(buffer);
  } catch (err) {
    console.error('Failed to generate PO image:', err);
    return res.status(500).send('Failed to generate PO image');
  }
});

/**
 * POST /api/whatsapp/send-po
 * Staff and Manager endpoint to send Purchase Order via WhatsApp Cloud API (PRESERVED LOGIC)
 */
whatsappRouter.post('/send-po', async (req: Request, res: Response) => {
  try {
    const idToken = extractBearerToken(req.headers.authorization);
    const {
      restaurantId,
      purchaseOrderId,
      userUid,
      userName,
      vendorPhone: bodyVendorPhone,
      messageBody: bodyMessageBody,
      po: bodyPo,
    } = req.body;

    if (!restaurantId || !purchaseOrderId) {
      return res.status(400).json({ error: 'restaurantId and purchaseOrderId are required' });
    }

    const config = await getRestaurantWhatsAppConfig(restaurantId, idToken);
    if (!config || !config.connected) {
      return res.status(400).json({
        code: 'WHATSAPP_NOT_CONFIGURED',
        error: 'Automatic WhatsApp is not configured. Use Manual WhatsApp.',
      });
    }

    const token = getTenantSecureToken(restaurantId);
    if (!token) {
      return res.status(400).json({
        code: 'WHATSAPP_NOT_CONFIGURED',
        error: 'Automatic WhatsApp is not configured. Use Manual WhatsApp.',
      });
    }

    // Fetch PO
    let po: PurchaseOrder | undefined = bodyPo;
    const poRef = doc(db, 'restaurants', restaurantId, 'purchaseOrders', purchaseOrderId);
    if (!po && idToken) {
      const restPo = await firestoreRestGetDoc(
        `restaurants/${restaurantId}/purchaseOrders/${purchaseOrderId}`,
        idToken
      );
      if (restPo) po = restPo as PurchaseOrder;
    }
    if (!po) {
      try {
        const poSnap = await getDoc(poRef);
        if (poSnap.exists()) {
          po = poSnap.data() as PurchaseOrder;
        }
      } catch (poErr) {
        console.warn('Could not fetch PO from server-side Firestore:', poErr);
      }
    }

    if (!po) {
      return res.status(404).json({ error: 'Purchase Order not found' });
    }

    // Fetch Vendor to get / verify phone
    let rawPhone = bodyVendorPhone || po.vendorPhone || '';
    if (!rawPhone && po.vendorId && idToken) {
      const restVendor = await firestoreRestGetDoc(
        `restaurants/${restaurantId}/vendors/${po.vendorId}`,
        idToken
      );
      if (restVendor) {
        rawPhone = restVendor.phone || restVendor.mobile || '';
      }
    }
    if (!rawPhone && po.vendorId) {
      try {
        const vendorRef = doc(db, 'restaurants', restaurantId, 'vendors', po.vendorId);
        const vendorSnap = await getDoc(vendorRef);
        if (vendorSnap.exists()) {
          const vendor = vendorSnap.data() as Vendor;
          rawPhone = vendor.phone || vendor.mobile || '';
        }
      } catch (vErr) {
        console.warn('Could not fetch vendor phone:', vErr);
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

    // Fetch restaurant name
    let restaurantName = 'STOQO';
    if (idToken) {
      const restDoc = await firestoreRestGetDoc(`restaurants/${restaurantId}`, idToken);
      if (restDoc?.name) restaurantName = restDoc.name;
    } else {
      try {
        const restDocRef = doc(db, 'restaurants', restaurantId);
        const restSnap = await getDoc(restDocRef);
        const restaurant = restSnap.data() as Restaurant | undefined;
        if (restaurant?.name) restaurantName = restaurant.name;
      } catch (rErr) {
        console.warn('Could not fetch restaurant name:', rErr);
      }
    }

    // Generate dynamic WhatsApp PO text containing ONLY ITEM + QUANTITY + UNIT (NO prices/amounts/rates/totals)
    const messageBody = bodyMessageBody || generatePoMessageText(po, restaurantName, po.vendorName);

    await recordWhatsAppAuditLog({
      restaurantId,
      actorUid: userUid || 'system',
      actorName: userName || 'Staff',
      action: 'PO_WHATSAPP_SEND_REQUESTED',
      entityId: po.id,
      details: `Initiating official WhatsApp Cloud API text dispatch for PO #${po.poNumber} to ${normalizedPhone}`,
      idToken,
    });

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
        mediaType: 'text',
        messageBody,
        createdAt: new Date().toISOString(),
        failedAt: new Date().toISOString(),
        errorMessage: errMsg,
        sentByUid: userUid,
        sentByName: userName,
      };

      if (idToken) {
        await firestoreRestPatchDoc(
          `restaurants/${restaurantId}/whatsappMessages/${failedMsgId}`,
          failedRecord,
          idToken
        );
      } else {
        try {
          const msgDocRef = doc(db, 'restaurants', restaurantId, 'whatsappMessages', failedMsgId);
          await setDoc(msgDocRef, failedRecord);
        } catch {
          // client also records error
        }
      }

      await recordWhatsAppAuditLog({
        restaurantId,
        actorUid: userUid || 'system',
        actorName: userName || 'Staff',
        action: 'PO_WHATSAPP_FAILED',
        entityId: po.id,
        details: `Failed to dispatch PO #${po.poNumber} via WhatsApp: ${errMsg}`,
        idToken,
      });

      return res.status(502).json({
        code: 'SEND_FAILED',
        error: `Failed to send via WhatsApp Business: ${errMsg}`,
      });
    }

    const messageId = metaResult.messageId;
    const now = new Date().toISOString();

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
      mediaType: 'text',
      messageBody,
      createdAt: now,
      sentAt: now,
      sentByUid: userUid,
      sentByName: userName,
    };

    try {
      if (idToken) {
        await firestoreRestPatchDoc(
          `restaurants/${restaurantId}/whatsappMessages/${messageId}`,
          messageRecord,
          idToken
        );
        await firestoreRestPatchDoc(
          `restaurants/${restaurantId}/purchaseOrders/${purchaseOrderId}`,
          {
            status: 'SENT',
            sentAt: now,
            sentByUid: userUid || 'system',
            sentByName: userName || 'Staff',
            whatsappMessageId: messageId,
            vendorPhone: normalizedPhone,
            whatsappSessionInfo: 'Order dispatched via official WhatsApp Business Cloud API',
            updatedAt: now,
          },
          idToken
        );
      } else {
        const msgDocRef = doc(db, 'restaurants', restaurantId, 'whatsappMessages', messageId);
        await setDoc(msgDocRef, messageRecord);
        await updateDoc(poRef, {
          status: 'SENT',
          sentAt: now,
          sentByUid: userUid || 'system',
          sentByName: userName || 'Staff',
          whatsappMessageId: messageId,
          vendorPhone: normalizedPhone,
          whatsappSessionInfo: 'Order dispatched via official WhatsApp Business Cloud API',
          updatedAt: now,
        });
      }

      await saveRestaurantWhatsAppConfig(
        restaurantId,
        {
          lastSuccessfulMessageAt: now,
        },
        idToken
      );

      await recordWhatsAppAuditLog({
        restaurantId,
        actorUid: userUid || 'system',
        actorName: userName || 'Staff',
        action: 'PO_WHATSAPP_SENT',
        entityId: po.id,
        details: `Successfully dispatched PO #${po.poNumber} text order via WhatsApp Cloud API (Message ID: ${messageId}) to ${normalizedPhone}`,
        idToken,
      });
    } catch (fsErr) {
      console.warn('Server-side Firestore writes note (client will also persist to Firestore):', fsErr);
    }

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
    const idToken = extractBearerToken(req.headers.authorization);
    const { restaurantId, recipientPhone, userUid, userName, userRole } = req.body || {};

    if (!restaurantId || !recipientPhone?.trim()) {
      return res.status(400).json({ error: 'restaurantId and recipientPhone are required' });
    }

    const ownerCheck = await verifyRestaurantOwnerAccess({
      restaurantId,
      idToken,
      fallbackUid: userUid,
      fallbackRole: userRole,
    });

    if (!ownerCheck.authorized) {
      return res.status(403).json({
        error:
          ownerCheck.reason ||
          'Forbidden: Only the restaurant Owner is authorized to send test WhatsApp messages.',
      });
    }

    const config = await getRestaurantWhatsAppConfig(restaurantId, idToken);
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
        error: 'WhatsApp access token is missing on the server. Click Reconnect to re-authorize.',
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

    let restaurantName = 'STOQO';
    if (idToken) {
      const restDoc = await firestoreRestGetDoc(`restaurants/${restaurantId}`, idToken);
      if (restDoc?.name) restaurantName = restDoc.name;
    }

    const testBody = `✅ WhatsApp Business Connection Test\n\nRestaurant: ${restaurantName}\nStatus: Verified & Operational\nDispatched: ${new Date().toLocaleString('en-IN')}\n\nYour restaurant's official WhatsApp Business Platform integration is active and ready to transmit Purchase Orders.`;

    const metaResult = await sendMetaCloudApiMessage({
      phoneNumberId: config.phoneNumberId,
      accessToken: token,
      to: normalizedPhone,
      body: testBody,
    });

    const now = new Date().toISOString();
    const messageId = metaResult.messageId;

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
      sentByUid: ownerCheck.uid || userUid,
      sentByName: userName,
    };

    if (idToken) {
      await firestoreRestPatchDoc(
        `restaurants/${restaurantId}/whatsappMessages/${messageId}`,
        messageRecord,
        idToken
      );
    } else {
      try {
        const msgDocRef = doc(db, 'restaurants', restaurantId, 'whatsappMessages', messageId);
        await setDoc(msgDocRef, messageRecord);
      } catch {
        // non-blocking
      }
    }

    await saveRestaurantWhatsAppConfig(
      restaurantId,
      {
        lastSuccessfulMessageAt: now,
      },
      idToken
    );

    await recordWhatsAppAuditLog({
      restaurantId,
      actorUid: ownerCheck.uid || userUid || 'system',
      actorName: userName || 'Owner',
      action: 'WHATSAPP_TEST_MESSAGE_SENT',
      details: `Sent test message via WhatsApp Cloud API to ${normalizedPhone} (ID: ${messageId})`,
      idToken,
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
 */
whatsappRouter.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expectedToken =
    process.env.WHATSAPP_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

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
 * Meta Webhook status notifications (sent, delivered, read, failed) & coexistence/account events
 */
whatsappRouter.post('/webhook', async (req: Request, res: Response) => {
  try {
    const appSecret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
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
        const businessAccountId = entry.id;
        if (!Array.isArray(entry.changes)) continue;

        for (const change of entry.changes) {
          const field = change.field;
          const value = change.value;
          const phoneNumberId = value?.metadata?.phone_number_id;

          // Handle WhatsApp Business App Coexistence / Account Update / History webhook events
          if (
            field === 'smb_message_echoes' ||
            field === 'smb_app_state_sync' ||
            field === 'history' ||
            field === 'account_update'
          ) {
            const restaurantId = await resolveRestaurantForMetaEvent({
              phoneNumberId,
              businessAccountId,
            });
            if (restaurantId) {
              const now = new Date().toISOString();
              await saveRestaurantWhatsAppConfig(restaurantId, {
                lastWebhookAt: now,
                ...(field === 'smb_message_echoes' || field === 'smb_app_state_sync'
                  ? { coexistenceMode: true }
                  : {}),
              });
            }
            continue;
          }

          if (!value || !Array.isArray(value.statuses)) continue;

          for (const statusObj of value.statuses) {
            const messageId = statusObj.id;
            const rawStatus = (statusObj.status || '').toLowerCase();

            if (!messageId || !['sent', 'delivered', 'read', 'failed'].includes(rawStatus)) {
              continue;
            }

            const timestamp = statusObj.timestamp
              ? new Date(Number(statusObj.timestamp) * 1000).toISOString()
              : new Date().toISOString();

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
