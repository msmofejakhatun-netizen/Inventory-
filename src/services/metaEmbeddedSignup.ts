export interface MetaEmbeddedSignupResult {
  code: string;
  wabaId?: string;
  phoneNumberId?: string;
  businessId?: string;
  eventType?: string;
}

interface FacebookSDK {
  init: (params: {
    appId: string;
    autoLogAppEvents?: boolean;
    xfbml?: boolean;
    version: string;
  }) => void;
  login: (
    callback: (response: {
      authResponse?: {
        code?: string;
        accessToken?: string;
        userID?: string;
      } | null;
      status?: string;
    }) => void,
    options: Record<string, any>
  ) => void;
}

declare global {
  interface Window {
    FB?: FacebookSDK;
    fbAsyncInit?: () => void;
  }
}

let sdkLoadPromise: Promise<FacebookSDK> | null = null;
let initializedAppId: string | null = null;

function loadFacebookSdk(appId: string, graphApiVersion = 'v25.0'): Promise<FacebookSDK> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Meta Embedded Signup can only run in a browser session.'));
  }

  if (window.FB) {
    if (initializedAppId !== appId) {
      window.FB.init({
        appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: graphApiVersion,
      });
      initializedAppId = appId;
    }
    return Promise.resolve(window.FB);
  }

  if (sdkLoadPromise) {
    return sdkLoadPromise;
  }

  sdkLoadPromise = new Promise<FacebookSDK>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      sdkLoadPromise = null;
      reject(
        new Error(
          'Timed out loading the official Meta Facebook SDK (connect.facebook.net). Please disable strict script blockers and try again.'
        )
      );
    }, 15000);

    window.fbAsyncInit = () => {
      window.clearTimeout(timeout);
      if (!window.FB) {
        sdkLoadPromise = null;
        reject(new Error('Official Meta SDK loaded without window.FB instance.'));
        return;
      }
      window.FB.init({
        appId,
        autoLogAppEvents: true,
        xfbml: true,
        version: graphApiVersion,
      });
      initializedAppId = appId;
      resolve(window.FB);
    };

    const existingScript = document.getElementById('facebook-jssdk');
    if (existingScript) {
      return;
    }

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      window.clearTimeout(timeout);
      sdkLoadPromise = null;
      reject(
        new Error(
          'Unable to load Meta SDK from connect.facebook.net. Check network connectivity or tracker blockers.'
        )
      );
    };
    document.head.appendChild(script);
  });

  return sdkLoadPromise;
}

/**
 * Launches the official Meta WhatsApp Embedded Signup V4 experience via Facebook Login for Business.
 * Uses the Facebook Login for Business Configuration ID (`config_id`) with V4 structure
 * and required permissions (`whatsapp_business_management`, `whatsapp_business_messaging`)
 * configured in Meta App Dashboard, without ever asking users for manual IDs or tokens.
 */
export async function launchMetaEmbeddedSignup(params: {
  appId?: string;
  configId?: string;
  graphApiVersion?: string;
  coexistenceMode?: boolean;
}): Promise<MetaEmbeddedSignupResult> {
  const resolvedAppId = (
    params.appId ||
    import.meta.env.VITE_META_APP_ID ||
    ''
  ).trim();
  const resolvedConfigId = (
    params.configId ||
    import.meta.env.VITE_META_EMBEDDED_SIGNUP_CONFIG_ID ||
    ''
  ).trim();
  const { graphApiVersion = 'v25.0', coexistenceMode = false } = params;

  if (!resolvedAppId || !resolvedConfigId) {
    throw new Error(
      'Missing Meta App ID (META_APP_ID / VITE_META_APP_ID) or Embedded Signup V4 Configuration ID (META_EMBEDDED_SIGNUP_CONFIG_ID / VITE_META_EMBEDDED_SIGNUP_CONFIG_ID).'
    );
  }

  const FB = await loadFacebookSdk(resolvedAppId, graphApiVersion);

  return new Promise<MetaEmbeddedSignupResult>((resolve, reject) => {
    let settled = false;
    let authCode: string | null = null;
    let sessionEvent: {
      wabaId?: string;
      phoneNumberId?: string;
      businessId?: string;
      eventType?: string;
    } | null = null;
    let cancelReason: string | null = null;
    let settleTimer: number | null = null;

    const cleanup = () => {
      window.removeEventListener('message', handleMetaSessionMessage);
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }
    };

    const finalizeIfReady = () => {
      if (settled) return;
      if (authCode && sessionEvent) {
        settled = true;
        cleanup();
        resolve({
          code: authCode,
          ...sessionEvent,
        });
      }
    };

    const handleMetaSessionMessage = (event: MessageEvent) => {
      if (
        event.origin !== 'https://www.facebook.com' &&
        event.origin !== 'https://web.facebook.com'
      ) {
        return;
      }

      let data: any = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }

      if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') {
        return;
      }

      if (
        data.event === 'FINISH' ||
        data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' ||
        data.event === 'FINISH_ONLY_WABA'
      ) {
        sessionEvent = {
          wabaId: data.data?.waba_id,
          phoneNumberId: data.data?.phone_number_id,
          businessId: data.data?.business_id,
          eventType: data.event,
        };
        finalizeIfReady();
      } else if (data.event === 'CANCEL') {
        const step = data.data?.current_step;
        cancelReason = step
          ? `Meta WhatsApp Embedded Signup was cancelled during step: ${step}.`
          : 'Meta WhatsApp Embedded Signup was cancelled before completion.';
      } else if (data.event === 'ERROR') {
        if (!settled) {
          settled = true;
          cleanup();
          reject(
            new Error(
              data.data?.error_message ||
                'Meta WhatsApp Embedded Signup reported an error during onboarding.'
            )
          );
        }
      }
    };

    window.addEventListener('message', handleMetaSessionMessage);

    // WhatsApp Embedded Signup V4: product & asset selection is driven by the
    // Facebook Login for Business Configuration ID (`config_id`) in Meta App Dashboard.
    // Standard V4 uses `extras: { setup: {} }`; Coexistence passes `featureType: 'whatsapp_business_app_onboarding'`.
    const extras: Record<string, any> = {
      setup: {},
    };
    if (coexistenceMode) {
      extras.featureType = 'whatsapp_business_app_onboarding';
    }

    try {
      FB.login(
        (response) => {
          if (settled) return;

          if (response?.authResponse?.code) {
            authCode = response.authResponse.code;
            if (sessionEvent) {
              finalizeIfReady();
              return;
            }
            // Wait briefly in case WA_EMBEDDED_SIGNUP postMessage arrives right after callback;
            // if unavailable, backend still resolves WABA & Phone Number via Graph API fallback.
            settleTimer = window.setTimeout(() => {
              if (settled) return;
              settled = true;
              cleanup();
              resolve({
                code: authCode!,
                ...(sessionEvent || {}),
              });
            }, 1400);
          } else {
            settled = true;
            cleanup();
            reject(
              new Error(
                cancelReason ||
                  'Meta login was closed or not authorized. Complete the Meta Business popup to connect WhatsApp Business.'
              )
            );
          }
        },
        {
          config_id: resolvedConfigId,
          response_type: 'code',
          override_default_response_type: true,
          extras,
        }
      );
    } catch (err) {
      if (!settled) {
        settled = true;
        cleanup();
        reject(
          new Error(
            err instanceof Error
              ? err.message
              : 'Failed to launch Meta Embedded Signup popup.'
          )
        );
      }
    }
  });
}
