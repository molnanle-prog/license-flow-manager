// Mock localStorage for Node.js environment
const mockLocalStorage: any = {
  getItem: (key: string) => null,
  setItem: (key: string, value: string) => {},
  removeItem: (key: string) => {}
};
(global as any).localStorage = mockLocalStorage;

import { fetchGoogleDriveBackups, fetchBackupContentFromDrive } from '../services/ezPrintWorkService';

async function listCloudBackups() {
  console.log("Fetching Google Drive backups...");
  const backups = await fetchGoogleDriveBackups();
  console.log("Backups list length:", backups.length);
  
  if (backups.length > 0) {
    // Get the most recent one
    const latest = backups[0];
    console.log(`Downloading latest backup: ${latest.name} (${latest.id})...`);
    const content = await fetchBackupContentFromDrive(latest.id);
    const data = JSON.parse(content);
    
    // Search for ccp5770@gmail.com in users or tenants
    console.log("Searching for ccp5770@gmail.com in backup...");
    const users = data.users || [];
    const foundUser = users.find((u: any) => u.email === 'ccp5770@gmail.com' || (u.loginId && u.loginId === 'ccp5770@gmail.com'));
    console.log("Found User in Backup:", foundUser);
    
    const tenants = data.tenants || [];
    const foundTenant = tenants.find((t: any) => t.ownerId === foundUser?.uid || t.name === '춘천인쇄');
    console.log("Found Tenant in Backup:", foundTenant);

    if (data.tenantSubcollections && foundTenant) {
      const sub = data.tenantSubcollections[foundTenant.id];
      console.log("Tenant staff in backup:", sub?.staff);
    }
  }
}

listCloudBackups().catch(console.error);
