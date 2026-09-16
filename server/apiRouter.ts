import express, { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';

export const apiRouter = express.Router();

apiRouter.use(express.json());

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

    const prompt = `You are the executive AI Analyst for "RESTAURANT STORE CONTROL SYSTEM" (Tagline: "Know your stock. Control your cash.").
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

// Subscription / Payment Gateway Endpoints
apiRouter.get('/subscription/status', (req: Request, res: Response) => {
  const razorpayKey = process.env.RAZORPAY_KEY_ID;
  const isConfigured = Boolean(razorpayKey && process.env.RAZORPAY_KEY_SECRET);

  res.json({
    planName: 'Pro Tier',
    priceInInr: 99,
    billingCycle: 'monthly',
    freeTrialDays: 14,
    gatewayConfigured: isConfigured,
    keyId: isConfigured ? razorpayKey : null,
  });
});

apiRouter.post('/subscription/create-order', (req: Request, res: Response) => {
  const razorpayKey = process.env.RAZORPAY_KEY_ID;
  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!razorpayKey || !razorpaySecret) {
    return res.status(503).json({
      configured: false,
      error: 'Payment gateway configuration required',
      message: 'Razorpay credentials (RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET) are not configured in server environment. In production, this verifies server-side INR 99 payments.',
    });
  }

  // Server-side controlled subscription order
  res.json({
    orderId: `sub_order_${Date.now()}`,
    keyId: razorpayKey,
    amount: req.body.amount || 9900,
    currency: 'INR',
  });
});

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

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({
      verified: false,
      error: 'Missing required payment verification parameters',
    });
  }

  try {
    const crypto = await import('crypto');
    const generatedSignature = crypto
      .createHmac('sha256', razorpaySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({
        verified: false,
        error: 'Invalid payment signature. Payment verification failed.',
      });
    }

    res.json({
      verified: true,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
    });
  } catch (err: any) {
    res.status(500).json({
      verified: false,
      error: 'Failed to verify payment cryptographic signature',
      details: err?.message,
    });
  }
});
