export type WhatsAppConnectionStatus =
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'CONFIGURATION_ERROR'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export type WhatsAppHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'DISCONNECTED';

export type WhatsAppMessageStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface WhatsAppConfig {
  connected: boolean;
  status: WhatsAppConnectionStatus;
  businessPhoneNumber: string;
  phoneNumberId: string;
  businessAccountId: string;
  connectedByUid: string;
  connectedByName?: string;
  connectedAt: string;
  lastWebhookAt?: string;
  lastSuccessfulMessageAt?: string;
  healthStatus: WhatsAppHealthStatus;
  lastHealthCheckAt?: string;
  lastError?: string;
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
