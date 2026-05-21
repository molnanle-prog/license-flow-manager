const { getPrintWorkLicenses } = require('../services/ezPrintWorkService');
const { getAppConfig } = require('../services/baseStorageService');

async function test() {
  try {
    const lics = await getPrintWorkLicenses(true);
    console.log(JSON.stringify(lics, null, 2));
  } catch (err) {
    console.error(err);
  }
}

test();
