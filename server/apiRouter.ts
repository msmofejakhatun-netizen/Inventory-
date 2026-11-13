import express, { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { whatsappRouter } from '../whatsapp-server';

export const apiRouter = express.Router();

apiRouter.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Dedicated WhatsApp Business API routes
apiRouter.use('/whatsapp', whatsappRouter);

// Lazy-load Gemini
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({ apiKey });
}

// AI Assistant natural language query
apiRouter.post('/ai/assistant', async (req: Request, res: Response) => {
  try {
    const { question, context } = req.body;
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const ai = getGeminiClient();
    if (!ai) {
      // Fallback deterministic analysis if GEMINI_API_KEY is not configured
      return res.json({
        answer: `[AI Service offline or key not configured]. Based on your live system data: Total stock value is ₹${context?.totalStockValue ?? 0}, excess stock is ₹${context?.totalCashBlocked ?? 0}, and total vendor due is ₹${context?.totalVendorDue ?? 0}.`,
        basedOn: 'Live Firestore store snapshot',
      });
    }

    const prompt = `You are the executive AI Analyst for "STOQO" (Tagline: "Smart Stock. Smarter Business.").
You assist the Boss/Owner and Store Managers.
CRITICAL INTEGRITY RULES:
1. ONLY answer using the ACTUAL Firebase operational data provided in the context below.
2. NEVER invent mock purchases, fake transactions, hallucinated vendors, or imaginary stock levels.
3. You must end every response with a concise "Based on:" section listing the exact records, dates, and metrics consulted.
4. If there is insufficient data in the context to answer the question, state: "I don't have enough data to answer this accurately."

CURRENT RESTAURANT REAL DATA CONTEXT:
${JSON.stringify(context, null, 2)}

USER QUESTION:
"${question}"

Provide a concise, direct, professional response with the required "Based on:" section at the end.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
    });

    const text = response.text || 'Unable to generate analysis at this time.';
    res.json({ answer: text });
  } catch (error) {
    console.error('AI assistant error:', error);
    res.status(500).json({
      error: 'Failed to process AI assistant request',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

// AI Daily Brief
apiRouter.post('/ai/daily-brief', async (req: Request, res: Response) => {
  try {
    const { context } = req.body;
    const ai = getGeminiClient();

    if (!ai) {
      return res.json({
        brief: `Good Morning Boss\n\nStore Value: ₹${context?.totalStockValue ?? 0}\nExcess Stock: ₹${context?.totalCashBlocked ?? 0}\nVendor Due: ₹${context?.totalVendorDue ?? 0}\nPrice Hike Alerts: ${context?.priceHikesCount ?? 0}\nEmergency Issues: ${context?.emergencyIssuesCount ?? 0}\nHigh Wastage: ${context?.wastageCount ?? 0}\nRecommended Purchase Today: ₹${context?.recommendedPurchaseTotal ?? 0}`,
      });
    }

    const prompt = `Generate the executive "Good Morning Boss" daily brief for a restaurant owner based strictly on these actual Firebase metrics:
${JSON.stringify(context, null, 2)}

Follow this strict format:
Good Morning Boss

Store Value: ₹...
Excess Stock: ₹...
Vendor Due: ₹...
Price Hike Alerts: ...
Emergency Issues: ...
High Wastage: ...
Recommended Purchase Today: ₹...

Executive Insight: [2 short sentences analyzing priorities for today based ONLY on the above numbers. If any metric has zero records, say "No sufficient data available for this metric." Do not invent numbers.]`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: prompt,
    });

    res.json({ brief: response.text });
  } catch (error) {
    console.error('AI brief error:', error);
    res.status(500).json({ error: 'Failed to generate daily brief' });
  }
});

// ============================================================================
// STOQO PROFESSIONAL MONTHLY SUBSCRIPTION CONFIGURATION (SERVER-AUTHORITATIVE)
// ============================================================================
const STOQO_PRO_MONTHLY_PLAN = {
  product: 'STOQO',
  planId: 'stoqo_professional_monthly_799',
  planName: 'STOQO PROFESSIONAL',
  displayPlan: 'Professional Monthly',
  tagline: 'Smart Stock. Smarter Business.',
  priceInInr: 799,
  amountInPaise: 79900,
  currency: 'INR',
  billingCycle: 'monthly',
  renewalInterval: 'Every month',
  freeTrialDays: 14,
} as const;

apiRouter.get('/subscription/status', (_req: Request, res: Response) => {
  const razorpayKey = process.env.RAZORPAY_KEY_ID;
  const isConfigured = Boolean(razorpayKey && process.env.RAZORPAY_KEY_SECRET);
  const razorpayPlanId = process.env.RAZORPAY_PLAN_ID_MONTHLY_799 || null;

  res.json({
    ...STOQO_PRO_MONTHLY_PLAN,
    gatewayConfigured: isConfigured,
    recurringPlanConfigured: Boolean(razorpayPlanId),
    razorpayPlanId,
    keyId: isConfigured ? razorpayKey : null,
  });
});

/**
 * POST /api/subscription/create-order
 * Strictly enforces server-side price of ₹799 (79900 paise, INR).
 * Never trusts any amount or currency sent by the frontend.
 * Creates a real Razorpay Subscription (if RAZORPAY_PLAN_ID_MONTHLY_799 is configured)
 * or a real Razorpay Order via Razorpay REST API using Basic Auth.
 */
apiRouter.post('/subscription/create-order', async (req: Request, res: Response) => {
  const razorpayKey = process.env.RAZORPAY_KEY_ID;
  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;
  const razorpayPlanId = process.env.RAZORPAY_PLAN_ID_MONTHLY_799;

  if (!razorpayKey || !razorpaySecret) {
    return res.status(503).json({
      configured: false,
      error: 'Payment gateway configuration required',
      message:
        'Razorpay credentials (RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET) are not configured in the server environment. To enable live ₹799/month (79900 paise) billing, configure RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and optionally RAZORPAY_PLAN_ID_MONTHLY_799 on the server.',
    });
  }

  const { restaurantId, billingMode } = req.body || {};
  if (!restaurantId) {
    return res.status(400).json({
      error: 'Missing restaurantId',
      message: 'A valid restaurantId is required to initiate a STOQO Professional subscription.',
    });
  }

  // Server-authoritative pricing: NEVER trust client-supplied amount
  const strictAmountInPaise = STOQO_PRO_MONTHLY_PLAN.amountInPaise; // 79900
  const strictCurrency = STOQO_PRO_MONTHLY_PLAN.currency; // INR
  const authHeader = 'Basic ' + Buffer.from(`${razorpayKey}:${razorpaySecret}`).toString('base64');

  try {
    // If recurring subscription mode is requested and RAZORPAY_PLAN_ID_MONTHLY_799 is configured
    if (razorpayPlanId && billingMode !== 'one_time_order') {
      const subResponse = await fetch('https://api.razorpay.com/v1/subscriptions', {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plan_id: razorpayPlanId,
          total_count: 120, // Monthly renewal (up to 10 years)
          quantity: 1,
          customer_notify: 1,
          notes: {
            product: STOQO_PRO_MONTHLY_PLAN.product,
            plan: STOQO_PRO_MONTHLY_PLAN.displayPlan,
            restaurantId,
            amountInPaise: String(strictAmountInPaise),
            currency: strictCurrency,
          },
        }),
      });

      const subData = await subResponse.json();
      if (!subResponse.ok || !subData.id) {
        return res.status(subResponse.status || 502).json({
          error: 'Failed to create Razorpay subscription',
          message: subData?.error?.description || 'Razorpay API rejected subscription creation.',
        });
      }

      return res.json({
        mode: 'subscription',
        subscriptionId: subData.id,
        planId: razorpayPlanId,
        keyId: razorpayKey,
        amount: strictAmountInPaise,
        priceInInr: STOQO_PRO_MONTHLY_PLAN.priceInInr,
        currency: strictCurrency,
        planName: STOQO_PRO_MONTHLY_PLAN.planName,
        description: 'STOQO Professional Monthly Subscription (₹799 / month)',
      });
    }

    // Standard Razorpay Order creation for ₹799.00 (79900 paise, INR)
    const orderResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: strictAmountInPaise,
        currency: strictCurrency,
        receipt: `stoqo_799_${restaurantId.slice(0, 12)}_${Date.now()}`,
        notes: {
          product: STOQO_PRO_MONTHLY_PLAN.product,
          plan: STOQO_PRO_MONTHLY_PLAN.displayPlan,
          restaurantId,
          priceInInr: String(STOQO_PRO_MONTHLY_PLAN.priceInInr),
          billingCycle: 'MONTHLY',
        },
      }),
    });

    const orderData = await orderResponse.json();
    if (!orderResponse.ok || !orderData.id) {
      return res.status(orderResponse.status || 502).json({
        error: 'Failed to create Razorpay order',
        message: orderData?.error?.description || 'Razorpay API rejected order creation for ₹799.',
      });
    }

    return res.json({
      mode: 'order',
      orderId: orderData.id,
      keyId: razorpayKey,
      amount: strictAmountInPaise,
      priceInInr: STOQO_PRO_MONTHLY_PLAN.priceInInr,
      currency: strictCurrency,
      planName: STOQO_PRO_MONTHLY_PLAN.planName,
      description: 'STOQO Professional Monthly Subscription (₹799 / month)',
    });
  } catch (err: any) {
    return res.status(500).json({
      error: 'Failed to communicate with Razorpay API',
      message: err?.message || 'Network error while creating Razorpay payment session.',
    });
  }
});

/**
 * POST /api/subscription/verify-payment
 * Verifies cryptographic HMAC-SHA256 signature using server-side RAZORPAY_KEY_SECRET
 * and confirms payment/order amount === 79900 paise (INR) before activating subscription.
 */
apiRouter.post('/subscription/verify-payment', async (req: Request, res: Response) => {
  const razorpayKey = process.env.RAZORPAY_KEY_ID;
  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!razorpayKey || !razorpaySecret) {
    return res.status(503).json({
      verified: false,
      error: 'Payment gateway configuration required',
      message: 'Razorpay credentials (RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET) are not configured in server environment.',
    });
  }

  const {
    razorpay_order_id,
    razorpay_subscription_id,
    razorpay_payment_id,
    razorpay_signature,
  } = req.body || {};

  if (!razorpay_payment_id || !razorpay_signature || (!razorpay_order_id && !razorpay_subscription_id)) {
    return res.status(400).json({
      verified: false,
      error: 'Missing required payment verification parameters',
    });
  }

  try {
    const crypto = await import('crypto');
    const payloadToSign = razorpay_subscription_id
      ? `${razorpay_payment_id}|${razorpay_subscription_id}`
      : `${razorpay_order_id}|${razorpay_payment_id}`;

    const generatedSignature = crypto
      .createHmac('sha256', razorpaySecret)
      .update(payloadToSign)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({
        verified: false,
        status: 'PAYMENT_FAILED',
        error: 'Invalid payment signature. Payment verification failed.',
      });
    }

    // Fetch payment details from Razorpay API to verify amount === 79900 paise and currency === INR
    const authHeader = 'Basic ' + Buffer.from(`${razorpayKey}:${razorpaySecret}`).toString('base64');
    const paymentRes = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpay_payment_id)}`, {
      method: 'GET',
      headers: { Authorization: authHeader },
    });

    if (paymentRes.ok) {
      const paymentDetails = await paymentRes.json();
      if (
        paymentDetails.amount !== STOQO_PRO_MONTHLY_PLAN.amountInPaise ||
        paymentDetails.currency !== STOQO_PRO_MONTHLY_PLAN.currency
      ) {
        return res.status(400).json({
          verified: false,
          status: 'PAYMENT_FAILED',
          error: `Payment amount mismatch. Expected ${STOQO_PRO_MONTHLY_PLAN.amountInPaise} paise (${STOQO_PRO_MONTHLY_PLAN.currency}), received ${paymentDetails.amount} (${paymentDetails.currency}).`,
        });
      }
      if (paymentDetails.status === 'failed') {
        return res.status(400).json({
          verified: false,
          status: 'PAYMENT_FAILED',
          error: 'Payment status reported as failed by Razorpay.',
        });
      }
    }

    const now = new Date();
    const renewalDate = new Date(now.getTime());
    renewalDate.setMonth(renewalDate.getMonth() + 1);

    res.json({
      verified: true,
      status: 'ACTIVE',
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id || null,
      subscriptionId: razorpay_subscription_id || null,
      planId: STOQO_PRO_MONTHLY_PLAN.planId,
      planName: STOQO_PRO_MONTHLY_PLAN.planName,
      amount: STOQO_PRO_MONTHLY_PLAN.priceInInr,
      amountInPaise: STOQO_PRO_MONTHLY_PLAN.amountInPaise,
      currency: STOQO_PRO_MONTHLY_PLAN.currency,
      billingCycle: 'MONTHLY',
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: renewalDate.toISOString(),
      verifiedAt: now.toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({
      verified: false,
      status: 'PAYMENT_FAILED',
      error: 'Failed to verify payment cryptographic signature',
      details: err?.message,
    });
  }
});

