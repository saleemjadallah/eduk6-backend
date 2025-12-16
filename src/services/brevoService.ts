/**
 * Brevo (formerly Sendinblue) integration service
 * Handles adding contacts to email marketing lists on signup
 */

import { logger } from '../utils/logger.js';

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_LIST_ID = parseInt(process.env.BREVO_LIST_ID || '3', 10);
const BREVO_API_URL = 'https://api.brevo.com/v3/contacts';

export type UserType = 'PARENT' | 'TEACHER';

export interface BrevoContactData {
  email: string;
  firstName?: string;
  lastName?: string;
  userType: UserType;
  subscriptionTier?: string;
}

interface BrevoCreateContactPayload {
  email: string;
  attributes: {
    FIRSTNAME?: string;
    LASTNAME?: string;
    USER_TYPE: string;
    SIGNUP_DATE: string;
    SUBSCRIPTION_TIER?: string;
  };
  listIds: number[];
  updateEnabled: boolean;
}

/**
 * Add a contact to the Brevo mailing list
 * This is called asynchronously (fire-and-forget) to not block signup flow
 */
export async function addContactToBrevo(data: BrevoContactData): Promise<boolean> {
  if (!BREVO_API_KEY) {
    logger.warn('Brevo API key not configured, skipping contact sync');
    return false;
  }

  try {
    const payload: BrevoCreateContactPayload = {
      email: data.email,
      attributes: {
        USER_TYPE: data.userType,
        SIGNUP_DATE: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
      },
      listIds: [BREVO_LIST_ID],
      updateEnabled: true, // Update if contact already exists
    };

    // Add optional attributes if provided
    if (data.firstName) {
      payload.attributes.FIRSTNAME = data.firstName;
    }
    if (data.lastName) {
      payload.attributes.LASTNAME = data.lastName;
    }
    if (data.subscriptionTier) {
      payload.attributes.SUBSCRIPTION_TIER = data.subscriptionTier;
    }

    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok || response.status === 201 || response.status === 204) {
      logger.info(`Contact added to Brevo: ${data.email} (${data.userType})`);
      return true;
    }

    // Handle duplicate contact (already exists) - this is fine
    if (response.status === 400) {
      const errorBody = await response.json().catch(() => ({})) as { code?: string; message?: string };
      if (errorBody.code === 'duplicate_parameter') {
        logger.info(`Contact already exists in Brevo: ${data.email}`);
        return true;
      }
      logger.warn(`Brevo API error for ${data.email}:`, errorBody);
      return false;
    }

    logger.warn(`Brevo API returned status ${response.status} for ${data.email}`);
    return false;
  } catch (error) {
    // Log but don't throw - we don't want to break signup if Brevo fails
    logger.error('Failed to add contact to Brevo:', error);
    return false;
  }
}

/**
 * Update a contact's attributes in Brevo
 * Useful for updating subscription tier when user upgrades
 */
export async function updateBrevoContact(
  email: string,
  attributes: Partial<{
    FIRSTNAME: string;
    LASTNAME: string;
    SUBSCRIPTION_TIER: string;
  }>
): Promise<boolean> {
  if (!BREVO_API_KEY) {
    logger.warn('Brevo API key not configured, skipping contact update');
    return false;
  }

  try {
    const response = await fetch(`${BREVO_API_URL}/${encodeURIComponent(email)}`, {
      method: 'PUT',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': BREVO_API_KEY,
      },
      body: JSON.stringify({ attributes }),
    });

    if (response.ok || response.status === 204) {
      logger.info(`Contact updated in Brevo: ${email}`);
      return true;
    }

    logger.warn(`Brevo update returned status ${response.status} for ${email}`);
    return false;
  } catch (error) {
    logger.error('Failed to update contact in Brevo:', error);
    return false;
  }
}

/**
 * Remove a contact from Brevo (for GDPR/account deletion)
 */
export async function removeBrevoContact(email: string): Promise<boolean> {
  if (!BREVO_API_KEY) {
    logger.warn('Brevo API key not configured, skipping contact removal');
    return false;
  }

  try {
    const response = await fetch(`${BREVO_API_URL}/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
      },
    });

    if (response.ok || response.status === 204) {
      logger.info(`Contact removed from Brevo: ${email}`);
      return true;
    }

    // 404 means contact doesn't exist - that's fine for deletion
    if (response.status === 404) {
      logger.info(`Contact not found in Brevo (already removed?): ${email}`);
      return true;
    }

    logger.warn(`Brevo delete returned status ${response.status} for ${email}`);
    return false;
  } catch (error) {
    logger.error('Failed to remove contact from Brevo:', error);
    return false;
  }
}
