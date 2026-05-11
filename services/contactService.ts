
import { AppConfig, License } from "../types";
import { getAccessToken } from "./googleSheetService";

/**
 * Syncs a customer license info to Google Contacts.
 * This function uses the People API.
 */
export const syncContactToGoogle = async (config: AppConfig, license: License): Promise<void> => {
    if (!config.enableContactSync) return;
    if (!config.clientEmail || !config.privateKey) return;
    if (!license.userName && !license.companyName) return;

    // Determine the subject email (User's Workspace email) or default to Service Account
    // Service Account contacts are not visible on user devices unless Domain-Wide Delegation is used.
    const subjectEmail = config.googleSubjectEmail || undefined;

    try {
        const token = await getAccessToken(config.clientEmail, config.privateKey, subjectEmail);

        const contactName = license.userName || license.companyName || 'Unknown';
        const contactInfo = license.contactInfo || '';
        const company = license.companyName || '';
        const note = `[LicenseFlow] ${license.productName || 'Product'} License\nKey: ${license.key}\nStatus: ${license.status}`;

        // 1. Check for duplicates (Simple search by name)
        // People API search is limited, so we iterate connections if needed or use search query
        const searchUrl = `https://people.googleapis.com/v1/people:searchContacts?query=${encodeURIComponent(contactName)}&readMask=names,phoneNumbers,emailAddresses`;
        
        const searchRes = await fetch(searchUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (searchRes.ok) {
            const searchData = await searchRes.json();
            if (searchData.results && searchData.results.length > 0) {
                console.log(`[ContactSync] Contact '${contactName}' likely already exists. Skipping creation to avoid duplicates.`);
                // In a more advanced version, we could update the contact here.
                return;
            }
        }

        // 2. Prepare Payload
        const isEmail = contactInfo.includes('@');
        const payload: any = {
            names: [{ givenName: contactName }],
            organizations: company ? [{ name: company, type: 'work' }] : [],
            biographies: [{ value: note, contentType: 'TEXT_PLAIN' }],
        };

        if (isEmail) {
            payload.emailAddresses = [{ value: contactInfo, type: 'work' }];
        } else if (contactInfo.length > 5) {
            payload.phoneNumbers = [{ value: contactInfo, type: 'mobile' }];
        }

        // 3. Create Contact
        const createUrl = `https://people.googleapis.com/v1/people:createContact`;
        const createRes = await fetch(createUrl, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!createRes.ok) {
            const err = await createRes.json();
            console.error('[ContactSync] Failed:', err);
            // Don't throw, just log. We don't want to break the license flow.
        } else {
            console.log(`[ContactSync] Successfully added '${contactName}' to Google Contacts.`);
        }

    } catch (e) {
        console.error("[ContactSync] Error:", e);
    }
};
