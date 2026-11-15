export type WhatsAppConnectionStatus =
  | 'CONNECTED'
  | 'NOT_CONNECTED'
  | 'ACTION_REQUIRED'
  | 'CONNECTION_ERROR'
  | 'DISCONNECTED'
  | 'CONFIGURATION_ERROR'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export type WhatsAppHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'DISCONNECTED';

export type WhatsAppWebhookStatus = 'ACTIVE' | 'INACTIVE' | 'ACTION_REQUIRED' | 'ERROR';

export type WhatsAppMessageStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface WhatsAppVerificationChecks {
  wabaVerified: boolean;
  phoneVerified: boolean;
  permissionsVerified: boolean;
  webhookSubscribed: boolean;
  webhookEndpointVerified: boolean;
}

export interface WhatsAppConfig {
  connected: boolean;
  status: WhatsAppConnectionStatus;
  businessPhoneNumber: string;
  verifiedName?: string;
  phoneNumberId: string;
  businessAccountId: string;
  businessId?: string;
  wabaName?: string;
  connectedByUid: string;
  connectedByName?: string;
  connectedAt: string;
  lastWebhookAt?: string;
  lastSuccessfulMessageAt?: string;
  healthStatus: WhatsAppHealthStatus;
  apiStatus?: WhatsAppHealthStatus;
  webhookStatus?: WhatsAppWebhookStatus;
  lastHealthCheckAt?: string;
  lastError?: string;
  actionRequiredReason?: string;
  missingRequirements?: string[];
  coexistenceMode?: boolean;
  onboardingType?: 'STANDARD_CLOUD_API' | 'WHATSAPP_BUSINESS_APP_COEXISTENCE' | 'WABA_ONLY';
  codeVerificationStatus?: string;
  qualityRating?: string;
  accountReviewStatus?: string;
  grantedPermissions?: string[];
  verificationChecks?: WhatsAppVerificationChecks;
  webhookVerifyToken?: string;
  hasCustomAccessToken?: boolean;
}

export interface WhatsAppMessageRecord {
  id: string;
  restaurantId: string;
  purchaseOrderId?: string;
  poNumber?: string;
  vendorId?: string;
  vendorName?: string;
  vendorPhone: string;
  messageId: string;
  status: WhatsAppMessageStatus;
  messageBody?: string;
  mediaType?: 'image' | 'text';
  mediaId?: string;
  imageUrl?: string;
  createdAt: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  failedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  isTestMessage?: boolean;
  sentByUid?: string;
  sentByName?: string;
}

export interface SendPoPayload {
  restaurantId: string;
  purchaseOrderId: string;
  vendorId: string;
}

export interface EmbeddedSignupCompletePayload {
  restaurantId: string;
  code: string;
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
  eventType?: string;
  coexistenceRequested?: boolean;
  userUid?: string;
  userName?: string;
  userRole?: string;
}

export interface ConnectWhatsAppPayload {
  restaurantId: string;
  businessPhoneNumber: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessToken?: string; // Optional restaurant-specific override, never saved to public client docs
}

export interface TestMessagePayload {
  restaurantId: string;
  recipientPhone: string;
}

